const keyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const saveBtn = document.getElementById("save");
const msg = document.getElementById("msg");

// Load saved values
chrome.storage.local.get(["anthropicApiKey", "claudeModel"], (data) => {
  if (data.anthropicApiKey) keyInput.value = data.anthropicApiKey;
  if (data.claudeModel) modelSelect.value = data.claudeModel;
});

saveBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    msg.style.color = "#c00";
    msg.textContent = "Please enter an API key.";
    return;
  }
  chrome.storage.local.set(
    { anthropicApiKey: key, claudeModel: modelSelect.value },
    () => {
      msg.style.color = "#16a34a";
      msg.textContent = "Saved!";
      setTimeout(() => { msg.textContent = ""; }, 2000);
    }
  );
});
