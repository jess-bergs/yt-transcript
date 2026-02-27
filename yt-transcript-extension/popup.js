const statusEl = document.getElementById("status");
const btnGrab = document.getElementById("btn-grab");
const btnSummarize = document.getElementById("btn-summarize");
const btnCopy = document.getElementById("btn-copy");
const btnDownload = document.getElementById("btn-download");
const transcriptBox = document.getElementById("transcript-box");
const summaryBox = document.getElementById("summary-box");
const tabBar = document.getElementById("tab-bar");
const promptRow = document.getElementById("prompt-row");
const promptInput = document.getElementById("prompt-input");

let currentVideoId = null;
let transcriptText = "";
let summaryText = "";
let activeTab = "transcript";

// --- Tab switching ---
tabBar.addEventListener("click", (e) => {
  const tab = e.target.dataset?.tab;
  if (!tab) return;
  activeTab = tab;
  tabBar.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  transcriptBox.classList.toggle("visible", tab === "transcript");
  summaryBox.classList.toggle("visible", tab === "summary");
});

// --- URL helpers ---
function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") {
      return u.searchParams.get("v");
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1);
    }
  } catch {
    return null;
  }
  return null;
}

// --- Check current tab on popup open ---
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.url) {
    statusEl.textContent = "Cannot access this page.";
    btnGrab.disabled = true;
    return;
  }
  currentVideoId = extractVideoId(tab.url);
  if (!currentVideoId) {
    statusEl.textContent =
      "Not a YouTube video page. Navigate to a video first.";
    btnGrab.disabled = true;
  } else {
    statusEl.textContent = `Video found: ${currentVideoId}`;
  }
});

// --- Grab transcript ---
btnGrab.addEventListener("click", async () => {
  if (!currentVideoId) return;
  btnGrab.disabled = true;
  statusEl.textContent = "Fetching transcript...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchTranscriptFromPage,
      args: [currentVideoId],
    });

    const result = results[0]?.result;
    if (result?.error) throw new Error(result.error);

    transcriptText = result.text;
    transcriptBox.textContent = transcriptText;
    transcriptBox.classList.add("visible");
    tabBar.style.display = "flex";
    btnCopy.style.display = "inline-block";
    btnDownload.style.display = "inline-block";
    btnSummarize.style.display = "inline-block";
    promptRow.style.display = "block";
    statusEl.textContent = `Transcript loaded (${transcriptText.length} chars)`;
  } catch (err) {
    statusEl.innerHTML = `<span class="error">Error: ${err.message}</span>`;
    btnGrab.disabled = false;
  }
});

// --- Summarize with Claude ---
btnSummarize.addEventListener("click", async () => {
  if (!transcriptText) return;
  btnSummarize.disabled = true;
  btnSummarize.textContent = "Summarizing...";
  statusEl.textContent = "Calling Claude...";

  try {
    const data = await chrome.storage.local.get([
      "anthropicApiKey",
      "claudeModel",
    ]);
    const apiKey = data.anthropicApiKey;
    if (!apiKey) {
      throw new Error(
        'No API key set. Right-click the extension icon → Options to add your Anthropic key.'
      );
    }
    const model = data.claudeModel || "claude-haiku-4-5-20251001";

    // Truncate to ~100k chars to stay within context limits
    const truncated = transcriptText.slice(0, 100_000);

    const userFocus = promptInput.value.trim();
    let prompt;
    if (userFocus) {
      prompt = `Here is a YouTube video transcript. The user has a specific request about it:\n\n"${userFocus}"\n\nAnswer their request thoroughly based on the transcript. Use headings and bullet points for readability.\n\nTranscript:\n${truncated}`;
    } else {
      prompt = `Summarize this YouTube video transcript. Produce a clear, well-structured summary that captures all the key points, arguments, and conclusions. Use headings and bullet points for readability. The summary should be thorough enough that someone who hasn't watched the video understands the full content.\n\nTranscript:\n${truncated}`;
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(
        err?.error?.message || `API error ${resp.status}`
      );
    }

    const json = await resp.json();
    summaryText = json.content?.[0]?.text || "No summary returned.";

    summaryBox.textContent = summaryText;

    // Switch to summary tab
    activeTab = "summary";
    tabBar.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === "summary");
    });
    transcriptBox.classList.remove("visible");
    summaryBox.classList.add("visible");
    tabBar.style.display = "flex";

    statusEl.textContent = "Summary ready.";
  } catch (err) {
    statusEl.innerHTML = `<span class="error">${err.message}</span>`;
  } finally {
    btnSummarize.textContent = "Summarize";
    btnSummarize.disabled = false;
  }
});

// --- Copy (copies whichever tab is active) ---
btnCopy.addEventListener("click", async () => {
  const text =
    activeTab === "summary" && summaryText ? summaryText : transcriptText;
  await navigator.clipboard.writeText(text);
  btnCopy.textContent = "Copied!";
  setTimeout(() => {
    btnCopy.textContent = "Copy";
  }, 1500);
});

// --- Download ---
btnDownload.addEventListener("click", () => {
  const isSummary = activeTab === "summary" && summaryText;
  const text = isSummary ? summaryText : transcriptText;
  const suffix = isSummary ? "-summary" : "";
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transcript-${currentVideoId}${suffix}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// =============================================
// Transcript fetcher — runs in the page context
// =============================================
async function fetchTranscriptFromPage(videoId) {
  try {
    const pageResp = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`
    );
    const pageHtml = await pageResp.text();

    // Find the captions JSON in the page source
    const marker = '"captions":';
    const idx = pageHtml.indexOf(marker);
    if (idx === -1) {
      return { error: "No captions/transcript available for this video." };
    }

    let captionsJson;
    try {
      // Walk from the opening brace, counting depth to find the matching close
      const start = idx + marker.length;
      let depth = 0;
      let end = start;
      for (let i = start; i < pageHtml.length; i++) {
        if (pageHtml[i] === "{") depth++;
        if (pageHtml[i] === "}") depth--;
        if (depth === 0) { end = i + 1; break; }
      }
      captionsJson = JSON.parse(pageHtml.slice(start, end));
    } catch {
      return { error: "Could not parse caption data." };
    }

    const tracks =
      captionsJson?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || tracks.length === 0) {
      return { error: "No caption tracks found for this video." };
    }

    const enTrack =
      tracks.find((t) => t.languageCode?.startsWith("en")) || tracks[0];

    const captionResp = await fetch(enTrack.baseUrl);
    const captionXml = await captionResp.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(captionXml, "text/xml");
    const textNodes = doc.querySelectorAll("text");

    const lines = [];
    for (const node of textNodes) {
      const tmp = document.createElement("span");
      tmp.innerHTML = node.textContent;
      const clean = tmp.textContent.trim();
      if (clean) lines.push(clean);
    }

    return { text: lines.join("\n") };
  } catch (err) {
    return { error: err.message || "Failed to fetch transcript." };
  }
}
