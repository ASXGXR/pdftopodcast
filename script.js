const apiKeyInput = document.getElementById("apiKey");
const pdfFileInput = document.getElementById("pdfFile");
const convertButton = document.getElementById("convertButton");
const generatedTextArea = document.getElementById("generatedText");
const audioPlayer = document.getElementById("audioPlayer");
const speakerOneNameInput = document.getElementById("speakerOneName");
const speakerOneVoiceSelect = document.getElementById("speakerOneVoice");
const speakerTwoNameInput = document.getElementById("speakerTwoName");
const speakerTwoVoiceSelect = document.getElementById("speakerTwoVoice");

window.addEventListener("load", () => {
  const savedKey = localStorage.getItem("chatGPTApiKey");
  if (savedKey) apiKeyInput.value = savedKey;
});

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

  // Get speaker names & voices
  const speakerOneName = speakerOneNameInput.value.trim() || "Alex";
  const speakerTwoName = speakerTwoNameInput.value.trim() || "Taylor";
  const speakerOneVoice = speakerOneVoiceSelect.value.toLowerCase() || "alloy";
  const speakerTwoVoice = speakerTwoVoiceSelect.value.toLowerCase() || "nova";

  // Extract PDF text
  const pdfText = await readPDF(file);
  // Ask ChatGPT to create a conversation
  const conversationText = await createPodcastConversation(pdfText, key);

  // Remove ** if present, then replace default names with user-defined names
  const removedAsterisks = conversationText.replace(/\*\*(.*?)\*\*/g, "$1");
  const cleanedText = removedAsterisks
    .replaceAll("Alex", speakerOneName)
    .replaceAll("Taylor", speakerTwoName);

  generatedTextArea.value = cleanedText;

  // Show Hidden Sections
  document.querySelector('.output-wrapper').style.display = 'block';

  const lines = cleanedText.split("\n").map(line => line.trim()).filter(Boolean);
  const audioRequests = lines.map(line => {
    const useVoice = line.startsWith(speakerTwoName) ? speakerTwoVoice : speakerOneVoice;
    return ttsRequest(line, useVoice, key);
  });

  const audioBuffers = await Promise.all(audioRequests);
  const mergedAudio = await mergeAudio(audioBuffers);
  audioPlayer.src = URL.createObjectURL(mergedAudio);
  audioPlayer.play();
});

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
        "You are an expert scriptwriter. Convert the provided PDF text into a lively, concise podcast conversation between Alex and Taylor where you simplify complex terms, focus on definitions, and provide stories for examples, helping me to revise for my upcoming test. You don't need an outro."
    },
    {
      role: "user",
      content: pdfText
    }
  ];
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages
    })
  });
  const json = await response.json();
  return json.choices?.[0]?.message?.content || "";
}

async function ttsRequest(inputText, selectedVoice, key) {
  try {
    const TTSText = `[en] ${inputText}`;
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
  } catch (err) {
    console.error("TTS error:", err);
    return null;
  }
}

async function mergeAudio(buffers) {
  const validBuffers = buffers.filter(b => b);
  if (!validBuffers.length) return new Blob([]);
  const audioCtx = new AudioContext();
  const decodedArray = await Promise.all(validBuffers.map(b => audioCtx.decodeAudioData(b.slice(0))));
  let totalLength = decodedArray.reduce((sum, audio) => sum + audio.length, 0);

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
  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = outputBuffer;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start(0);

  const rendered = await offlineCtx.startRendering();
  const mergedArrayBuffer = await encodeWav(rendered);
  return new Blob([mergedArrayBuffer], { type: "audio/wav" });
}

function encodeWav(audioBuffer) {
  const numOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;
  let length = audioBuffer.length * numOfChannels * 2 + 44;
  let buffer = new ArrayBuffer(length);
  let view = new DataView(buffer);

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
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, audioBuffer.length * numOfChannels * 2, true);

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numOfChannels; channel++) {
      let sample = audioBuffer.getChannelData(channel)[i] * 32767;
      if (sample < -32768) sample = -32768;
      if (sample > 32767) sample = 32767;
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




// File Dropping

const pdfInput = document.getElementById('pdfFile');
const dropzone = document.getElementById('dropzone');
const fileNameDisplay = document.getElementById('fileName');

pdfInput.addEventListener('change', (event) => {
  const file = event.target.files[0]; // Get the first selected file
  if (file) {
    // Update the dropzone style to indicate a file has been added
    dropzone.classList.add('file-added');

    // Display the file name below the dropzone
    fileNameDisplay.textContent = `Selected file: ${file.name}`;
    fileNameDisplay.classList.add('visible');
  } else {
    // If no file is selected, reset the dropzone style
    dropzone.classList.remove('file-added');
    fileNameDisplay.textContent = '';
    fileNameDisplay.classList.remove('visible');
  }
});