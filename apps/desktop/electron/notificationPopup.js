// Notification popup UI. Kept out of the HTML so the page's CSP can forbid inline scripts.
let currentTag = "";

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(data) {
  currentTag = data.tag || "";
  document.getElementById("appName").textContent = data.appName || "Espalha Brasas";
  if (data.appIcon) {
    document.getElementById("appIcon").src = data.appIcon;
    document.getElementById("appIcon").hidden = false;
  } else {
    document.getElementById("appIcon").hidden = true;
  }

  const avatarEl = document.getElementById("avatar");
  avatarEl.textContent = "";
  if (data.authorAvatar) {
    const img = document.createElement("img");
    img.src = data.authorAvatar;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = (data.authorName || "?").charAt(0).toUpperCase();
  }

  document.getElementById("author").textContent = data.authorName || "Someone";
  const contextEl = document.getElementById("context");
  if (data.context) {
    contextEl.textContent = data.context;
    contextEl.hidden = false;
  } else {
    contextEl.hidden = true;
  }
  document.getElementById("preview").textContent = data.preview || "New message";
  document.getElementById("card").hidden = false;
}

document.getElementById("closeBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  window.notifyAPI.action({ tag: currentTag, action: "close" });
});

document.getElementById("card").addEventListener("click", () => {
  window.notifyAPI.action({ tag: currentTag, action: "open" });
});

window.notifyAPI.onData(render);
