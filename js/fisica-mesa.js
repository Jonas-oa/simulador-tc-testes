/**
 * js/fisica-mesa.js
 * Extraído na Etapa 6.
 * Gerencia o estado físico, os limites e os movimentos (livres e guiados) da mesa de TC.
 * Desacoplado da cena 3D (THREE.js).
 */
(function () {
  "use strict";

  // Limites mecânicos
  var TABLE_Y_MIN = 0.50;
  var TABLE_Y_MAX = 0.88;
  var GANTRY_Y_MIN = 0.64;
  var GANTRY_Y_MAX = 0.88;
  var TABLE_Z_MAX = 0.90;
  var TABLE_Z_MIN = -1.10;
  var BORE_SAFE_Z = 0.20;

  var SPEED_Z = 0.08; // m/s
  var SPEED_Y = 0.02; // m/s

  // Estado atual
  var tableY = 0.80; // isocentro inicial
  var tableZ = TABLE_Z_MAX; // totalmente retraída
  
  // Estado de movimento comandado pelo operador
  var moveUp = false;
  var moveDown = false;
  var moveIn = false;
  var moveOut = false;

  // Movimento guiado (topograma, helicoidal, posicionamento)
  var autoDrive = null; 
  var alertStatus = "";
  var ultimoAlerta = "";

  // Callbacks para atualizar a view (THREE.js e UI)
  var viewCallbacks = {
    onMove: function (y, z) {},
    onAlert: function (msg) {},
    onSpinSet: function (rotTimeS) {},
    onUpdateReadout: function (speedMmS) {}
  };

  function setViewCallbacks(cb) {
    for (var k in cb) {
      if (Object.prototype.hasOwnProperty.call(cb, k)) {
        viewCallbacks[k] = cb[k];
      }
    }
  }

  // Passos do laço físico
  function passoFisica(dt) {
    var nextY = tableY, nextZ = tableZ;
    alertStatus = "";

    var isInsideBore = tableZ < BORE_SAFE_Z;
    var yMin = isInsideBore ? GANTRY_Y_MIN : TABLE_Y_MIN;
    var yMax = isInsideBore ? GANTRY_Y_MAX : TABLE_Y_MAX;

    if (autoDrive) {
      var adDir = (autoDrive.targetZ >= tableZ) ? 1 : -1;
      nextZ = tableZ + adDir * autoDrive.speed * dt;
      if ((adDir > 0 && nextZ >= autoDrive.targetZ) || (adDir < 0 && nextZ <= autoDrive.targetZ)) {
        nextZ = autoDrive.targetZ;
      }
      nextZ = Math.max(TABLE_Z_MIN, Math.min(TABLE_Z_MAX, nextZ));
    } else {
      if (moveUp) nextY = Math.min(yMax, tableY + SPEED_Y * dt);
      if (moveDown) nextY = Math.max(yMin, tableY - SPEED_Y * dt);
      if (moveIn) nextZ = Math.max(TABLE_Z_MIN, tableZ - SPEED_Z * dt);
      if (moveOut) nextZ = Math.min(TABLE_Z_MAX, tableZ + SPEED_Z * dt);
    }

    var willEnterBore = nextZ < BORE_SAFE_Z && tableZ >= BORE_SAFE_Z;
    var isHeightSafe = nextY >= GANTRY_Y_MIN && nextY <= GANTRY_Y_MAX;

    if (willEnterBore && !isHeightSafe) {
      nextZ = tableZ;
      alertStatus = "ALTURA INCOMPATÍVEL para entrada no gantry (ajuste para 64–88 cm)";
    }

    var moved = tableY !== nextY || tableZ !== nextZ;
    if (moved) {
      tableY = nextY;
      tableZ = nextZ;
      viewCallbacks.onMove(tableY, tableZ);
    }

    var anyMoveFlag = moveUp || moveDown || moveIn || moveOut;
    SimTC.setIndicator("motion", (anyMoveFlag || !!autoDrive) && moved);

    if (autoDrive) {
      var ad = autoDrive;
      if (alertStatus) {
        autoDrive = null; 
        viewCallbacks.onSpinSet(0);
        if (ad.onAbort) ad.onAbort(alertStatus);
      } else {
        var span = Math.abs(ad.targetZ - ad.startZ);
        var prog = span > 0 ? Math.min(1, Math.abs(tableZ - ad.startZ) / span) : 1;
        if (ad.onProgress) ad.onProgress(prog, tableZ);
        if (tableZ === ad.targetZ) {
          autoDrive = null; 
          viewCallbacks.onSpinSet(0);
          if (ad.onDone) ad.onDone();
        }
      }
    }

    if (alertStatus && alertStatus !== ultimoAlerta) {
      viewCallbacks.onAlert(alertStatus);
    }
    ultimoAlerta = alertStatus;

    var speedMmS = 0;
    if (autoDrive) speedMmS = autoDrive.speed * 1000;
    else if (moveIn || moveOut) speedMmS = SPEED_Z * 1000;
    else if (moveUp || moveDown) speedMmS = SPEED_Y * 1000;
    
    viewCallbacks.onUpdateReadout(speedMmS);
  }

  function iniciarVarredura(opts) {
    if (autoDrive) {
      return { ok: false, motivo: "Mesa já em movimento" };
    }
    var dist = opts.distM || 0;
    var dir = (opts.dir === "caudocranial") ? 1 : -1;
    var target = Math.max(TABLE_Z_MIN, Math.min(TABLE_Z_MAX, tableZ + dir * dist));
    var travel = Math.abs(target - tableZ);

    if (travel < dist * 0.98) {
      var faltamMm = Math.round((dist - travel) * 1000);
      var acao = (dir < 0) ? "out" : "in";
      var partida = Math.max(TABLE_Z_MIN, Math.min(TABLE_Z_MAX, target - dir * dist));
      var cursoDaPartida = Math.abs(
        Math.max(TABLE_Z_MIN, Math.min(TABLE_Z_MAX, partida + dir * dist)) - partida);

      if (opts.posicionarAntes === true && cursoDaPartida >= dist * 0.98) {
        var deslocMm = Math.round(Math.abs(partida - tableZ) * 1000);
        viewCallbacks.onAlert("Mesa posicionada " + deslocMm + " mm " +
          (partida < tableZ ? "para dentro" : "para fora") +
          " do gantry para acomodar a varredura de " + Math.round(dist * 1000) +
          " mm. A aquisição começa em seguida.");
        
        moveUp = moveDown = moveIn = moveOut = false;
        var opcoesDaVarredura = opts;
        
        autoDrive = {
          targetZ: partida,
          startZ: tableZ,
          speed: Math.max(0.02, SPEED_Z),
          onProgress: null,
          onAbort: opts.onAbort || null,
          onDone: function () {
            var seg = {};
            for (var k in opcoesDaVarredura) {
              if (Object.prototype.hasOwnProperty.call(opcoesDaVarredura, k)) {
                seg[k] = opcoesDaVarredura[k];
              }
            }
            seg.posicionarAntes = false;
            var r2 = iniciarVarredura(seg);
            if (!r2 || !r2.ok) {
              viewCallbacks.onAlert("Não foi possível iniciar após posicionar: " +
                ((r2 && r2.motivo) || "curso indisponível"));
              if (opcoesDaVarredura.onAbort) {
                opcoesDaVarredura.onAbort((r2 && r2.motivo) || "curso indisponível");
              }
            }
          }
        };
        viewCallbacks.onSpinSet(0);
        return { ok: true, posicionando: true, deslocamentoMm: deslocMm, startZ: partida };
      }

      return {
        ok: false,
        acao: acao,
        faltamMm: faltamMm,
        motivo: "Curso insuficiente: faltam " + faltamMm + " mm " +
          (dir < 0 ? "para dentro do gantry" : "para fora do gantry") + ". " +
          (acao === "out"
            ? "Use SAIR para recuar a mesa e ganhar curso antes de iniciar."
            : "Use ENTRAR para avançar a mesa e ganhar curso antes de iniciar.")
      };
    }

    moveUp = moveDown = moveIn = moveOut = false;
    var startZ0 = tableZ;
    autoDrive = {
      targetZ: target,
      startZ: startZ0,
      speed: Math.max(0.005, (opts.speedMmS || 50) / 1000),
      onProgress: opts.onProgress || null,
      onDone: opts.onDone || null,
      onAbort: opts.onAbort || null
    };
    viewCallbacks.onSpinSet(opts.rotTimeS || 0);
    return { ok: true, startZ: startZ0, targetZ: target };
  }

  function abortAutoDrive(motivo) {
    if (autoDrive) {
      var ad = autoDrive;
      autoDrive = null;
      viewCallbacks.onSpinSet(0);
      if (ad.onAbort) ad.onAbort(motivo || "Abortado");
    }
  }

  // Controles manuais
  function setCmd(cmd, value) {
    if (cmd === 'in') moveIn = value;
    else if (cmd === 'out') moveOut = value;
    else if (cmd === 'up') moveUp = value;
    else if (cmd === 'down') moveDown = value;
    if (value && autoDrive) abortAutoDrive();
  }
  
  function zerarMesa() {
    if (autoDrive) return;
    tableY = 0.80; // Isocentro
    tableZ = BORE_SAFE_Z; // Borda
    viewCallbacks.onMove(tableY, tableZ);
  }

  window.SimTC = window.SimTC || {};
  SimTC.FisicaMesa = {
    passoFisica: passoFisica,
    setViewCallbacks: setViewCallbacks,
    iniciarVarredura: iniciarVarredura,
    abortAutoDrive: abortAutoDrive,
    setCmd: setCmd,
    zerarMesa: zerarMesa,
    getZ: function() { return tableZ; },
    getY: function() { return tableY; }
  };

})();
