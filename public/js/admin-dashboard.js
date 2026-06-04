(function () {
  "use strict";

  window.abInitHome = function () {
    var root = document.getElementById("admin-home-app");
    if (!root || root.dataset.inited === "1") return;
    root.dataset.inited = "1";
  };

  window.abReloadAdminHome = function () {};
})();
