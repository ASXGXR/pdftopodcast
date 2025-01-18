// ===== Elements =====
const apiKeyInput = document.getElementById("apiKey");
const pdfFileInput = document.getElementById("pdfFile");
const convertButton = document.getElementById("convertButton");
const generatedTextArea = document.getElementById("generatedText");
const audioPlayer = document.getElementById("audioPlayer");
const pdfInput = document.getElementById("pdfFile");
const dropzone = document.getElementById("dropzone");
const fileNameDisplay = document.getElementById("fileName");

// ===== Getting API Key =====
window.addEventListener("load", () => {
  const savedKey = localStorage.getItem("chatGPTApiKey");
  if (savedKey) apiKeyInput.value = savedKey;
});

// ===== File Dropzone =====
pdfInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) {
    dropzone.classList.add("file-added");
    fileNameDisplay.textContent = `Selected file: ${file.name}`;
    fileNameDisplay.classList.add("visible");
  } else {
    dropzone.classList.remove("file-added");
    fileNameDisplay.textContent = "";
    fileNameDisplay.classList.remove("visible");
  }
});

// ===== Button Click =====
convertButton.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    alert("Please enter your ChatGPT API key.");
    return;
  }
  localStorage.setItem("chatGPTApiKey", key);

  const file = pdfFileInput.files[0];
  if (!file) {
    alert("Please upload a PDF file.");
    return;
  }

  // Speaker details
  const speakerOneName = "Alex";
  const speakerTwoName = "Taylor";
  const speakerOneVoice = "alloy";
  const speakerTwoVoice = "nova";

  // Show the loading spinner
  document.getElementById("loadingSpinner").style.display = "flex";

  try {
    // Extract PDF text and create podcast conversation
    const pdfText = await readPDF(file);
    const conversationText = await createPodcastConversation(pdfText, key);

    // Replace default names and clean text
    const cleanedText = conversationText
      .replace(/\*\*(.*?)\*\*/g, "$1") // replace asterix
      .replaceAll("Alex", speakerOneName)
      .replaceAll("Taylor", speakerTwoName);

    generatedTextArea.value = cleanedText;

    // Show output section
    document.querySelector(".output-wrapper").style.display = "block";

    // Generate TTS audio
    const lines = cleanedText
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    const audioRequests = lines.map(line => {
      // Remove speaker name from the line
      const useVoice = line.startsWith(speakerTwoName) ? speakerTwoVoice : speakerOneVoice;
      const cleanedLine = line.replace(new RegExp(`^(${speakerOneName}|${speakerTwoName}):\\s*`), "");
      return ttsRequest(cleanedLine, useVoice, key);
    });

    const audioBuffers = await Promise.all(audioRequests);
    const mergedAudio = await mergeAudio(audioBuffers);

    audioPlayer.src = URL.createObjectURL(mergedAudio);
    audioPlayer.play();
    
    // Hide the loading spinner
    document.getElementById("loadingSpinner").style.display = "none";

  } catch (error) {
    console.error("Error during conversion:", error);
    alert("An error occurred during the conversion process.");
  }
});

// ===== Helper Functions =====
async function readPDF(file) {
  const fileReader = new FileReader();
  return new Promise((resolve) => {
    fileReader.onload = async function () {
      const typedarray = new Uint8Array(this.result);
      const pdf = await pdfjsLib.getDocument(typedarray).promise;
      let combinedText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        combinedText += textContent.items.map(item => item.str).join(" ") + "\n";
      }
      resolve(combinedText.trim());
    };
    fileReader.readAsArrayBuffer(file);
  });
}

async function createPodcastConversation(pdfText, key) {
  const url = "https://api.openai.com/v1/chat/completions";
  const messages = [
    {
      role: "system",
      content:
        "You are an expert scriptwriter. Convert the provided PDF text into a lively, concise podcast conversation between Alex and Taylor. Simplify complex terms and focus on examples and definitions for better revision."
    },
    { role: "user", content: pdfText }
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({ model: "gpt-4", messages })
  });
  const json = await response.json();
  return json.choices?.[0]?.message?.content || "";
}

async function ttsRequest(inputText, selectedVoice, key) {
  const TTSText = `[en] ${inputText}`;
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: selectedVoice,
        input: TTSText,
        format: "mp3"
      })
    });
    if (!response.ok) throw new Error("TTS fetch error");
    return await response.arrayBuffer();
  } catch (error) {
    console.error("TTS error:", error);
    return null;
  }
}

async function mergeAudio(buffers) {
  const audioCtx = new AudioContext();
  const decodedArray = await Promise.all(
    buffers.filter(Boolean).map(b => audioCtx.decodeAudioData(b))
  );
  const totalLength = decodedArray.reduce((sum, audio) => sum + audio.length, 0);
  const outputBuffer = audioCtx.createBuffer(
    decodedArray[0].numberOfChannels,
    totalLength,
    decodedArray[0].sampleRate
  );

  let offset = 0;
  decodedArray.forEach(data => {
    for (let c = 0; c < data.numberOfChannels; c++) {
      outputBuffer.getChannelData(c).set(data.getChannelData(c), offset);
    }
    offset += data.length;
  });

  const offlineCtx = new OfflineAudioContext(
    outputBuffer.numberOfChannels,
    outputBuffer.length,
    outputBuffer.sampleRate
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = outputBuffer;
  source.connect(offlineCtx.destination);
  source.start();

  const rendered = await offlineCtx.startRendering();
  return new Blob([await encodeWav(rendered)], { type: "audio/wav" });
}

function encodeWav(audioBuffer) {
  const numOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length * numOfChannels * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + audioBuffer.length * numOfChannels * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChannels * 2, true);
  view.setUint16(32, numOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, audioBuffer.length * numOfChannels * 2, true);

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numOfChannels; channel++) {
      const sample = Math.max(-32768, Math.min(32767, audioBuffer.getChannelData(channel)[i] * 32767));
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}