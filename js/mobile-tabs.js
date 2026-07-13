/**
 * Navegação móvel em quatro telas.
 * Complementa o modo celular existente sem alterar cena, física ou IndexedDB.
 */
(function () {
  "use strict";

  var VIEW_CLASSES = ["mob-3d", "mob-aq", "mob-proto", "mob-pac"];
  var STORAGE_VIEW = "simuladorTC.mobileView";
  var STORAGE_EXIT = "simuladorTC.mobileExit";

  function initMobileTabs() {
    var body = document.body;
    var mobileToggle = document.getElementById("mobile-toggle");
    var mobileSwitch = document.getElementById("mobile-switch");
    var exitButton = document.getElementById("mob-exit");
    var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-mobile-view]"));

    if (!body || !mobileToggle || !mobileSwitch || buttons.length !== 4) return;

    function normalizeView(view) {
      return ["3d", "aq", "proto", "pac"].indexOf(view) >= 0 ? view : "3d";
    }

    function setView(view, save) {
      view = normalizeView(view);
      VIEW_CLASSES.forEach(function (name) { body.classList.remove(name); });
      body.classList.add("mob-" + view);

      buttons.forEach(function (button) {
        var active = button.getAttribute("data-mobile-view") === view;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });

      if (save !== false) {
        try { localStorage.setItem(STORAGE_VIEW, view); } catch (error) { /* sem persistência */ }
      }

      window.requestAnimationFrame(function () {
        window.dispatchEvent(new Event("resize"));
        var activePane = body.querySelector(".dash-pane:not([style*='display: none'])");
        if (activePane) activePane.scrollTop = 0;
      });
    }

    function storedView() {
      try { return normalizeView(localStorage.getItem(STORAGE_VIEW)); }
      catch (error) { return "3d"; }
    }

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        setView(button.getAttribute("data-mobile-view"));
      });
    });

    mobileToggle.addEventListener("click", function () {
      if (body.classList.contains("is-mobile")) {
        try { sessionStorage.removeItem(STORAGE_EXIT); } catch (error) { /* sem persistência */ }
        setView(storedView(), false);
      }
    });

    if (exitButton) {
      exitButton.addEventListener("click", function () {
        try { sessionStorage.setItem(STORAGE_EXIT, "1"); } catch (error) { /* sem persistência */ }
      });
    }

    var narrowScreen = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
    var manuallyExited = false;
    try { manuallyExited = sessionStorage.getItem(STORAGE_EXIT) === "1"; } catch (error) { /* sem persistência */ }

    if (narrowScreen && !body.classList.contains("is-mobile") && !manuallyExited) {
      mobileToggle.click();
    } else if (body.classList.contains("is-mobile")) {
      setView(storedView(), false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMobileTabs);
  } else {
    initMobileTabs();
  }
})();
