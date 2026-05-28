(function (global) {
  "use strict";

  var MODAL_ID = "modal-receipt-sent-success";
  var CONFETTI_ID = "receipt-sent-confetti";
  var DEFAULT_SITE_URL = "https://andreybolotov.ru";

  function buildReceiptSentShareMessage(siteUrl) {
    var url = (siteUrl || DEFAULT_SITE_URL).replace(/\/$/, "");
    return [
      "🎉 Я участвую в акциях «Быть добру!»",
      "",
      "✨ Присоединяйся к акциям у Андрея Болотова",
      "🎯 Выбирай номерки, оплачивай и участвуй — это просто",
      "",
      "🔗 " + url,
    ].join("\n");
  }
  var confettiTimer = null;
  var onDismissCb = null;
  var wired = false;

  function openOverlay(el) {
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeOverlay(el) {
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal-overlay.is-open")) document.body.style.overflow = "";
  }

  function stopConfetti() {
    if (confettiTimer) {
      clearInterval(confettiTimer);
      confettiTimer = null;
    }
    var root = document.getElementById(CONFETTI_ID);
    if (root) root.replaceChildren();
  }

  function spawnConfettiPiece(root) {
    var colors = ["#f43f5e", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa", "#f472b6"];
    var el = document.createElement("span");
    el.className = "receipt-sent-confetti__piece";
    el.style.left = Math.random() * 100 + "%";
    el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = 2.4 + Math.random() * 2.2 + "s";
    el.style.animationDelay = Math.random() * 0.35 + "s";
    var w = 5 + Math.floor(Math.random() * 6);
    var h = 8 + Math.floor(Math.random() * 8);
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.borderRadius = Math.random() > 0.5 ? "999px" : "2px";
    root.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 5200);
  }

  function startConfetti() {
    var root = document.getElementById(CONFETTI_ID);
    if (!root) return;
    stopConfetti();
    var i;
    for (i = 0; i < 36; i++) spawnConfettiPiece(root);
    confettiTimer = setInterval(function () {
      var j;
      for (j = 0; j < 4; j++) spawnConfettiPiece(root);
    }, 420);
  }

  function wireOnce() {
    if (wired) return;
    wired = true;
    var modal = document.getElementById(MODAL_ID);
    var shareBtn = document.getElementById("receipt-sent-share");
    var okBtn = document.getElementById("receipt-sent-ok");

    function dismiss() {
      stopConfetti();
      if (modal) closeOverlay(modal);
      var cb = onDismissCb;
      onDismissCb = null;
      if (cb) cb();
    }

    if (okBtn) okBtn.addEventListener("click", dismiss);
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) dismiss();
      });
    }
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        AbReceiptSent.share().then(function (r) {
          if (r === "copied" && global.showToast) global.showToast("Текст скопирован — отправьте другу", "success");
        });
      });
    }
  }

  function shareReceiptSentInvite() {
    var origin = global.location ? global.location.origin : "";
    var message = buildReceiptSentShareMessage(origin || DEFAULT_SITE_URL);
    if (global.navigator && typeof global.navigator.share === "function") {
      return global.navigator
        .share({ title: "Быть добру! — акции Андрея Болотова", text: message })
        .then(function () {
          return "shared";
        })
        .catch(function (e) {
          if (e && e.name === "AbortError") return "cancelled";
          return Promise.reject(e);
        });
    }
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(message).then(function () {
        return "copied";
      });
    }
    return Promise.resolve("cancelled");
  }

  function openReceiptSentSuccessModal(opts) {
    wireOnce();
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    onDismissCb = opts && opts.onDismiss ? opts.onDismiss : null;
    startConfetti();
    openOverlay(modal);
  }

  global.AbReceiptSent = {
    buildShareMessage: buildReceiptSentShareMessage,
    open: openReceiptSentSuccessModal,
    share: shareReceiptSentInvite,
    stopConfetti: stopConfetti,
  };
})(typeof window !== "undefined" ? window : globalThis);
