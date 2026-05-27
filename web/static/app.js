const portSelect = document.querySelector("#portSelect");
const baudInput = document.querySelector("#baudInput");
const connectButton = document.querySelector("#connectButton");
const disconnectButton = document.querySelector("#disconnectButton");
const refreshPortsButton = document.querySelector("#refreshPortsButton");
const connectionText = document.querySelector("#connectionText");
const messageText = document.querySelector("#messageText");
const pwmInput = document.querySelector("#pwmInput");
const sendPwmButton = document.querySelector("#sendPwmButton");
const sendMotorButton = document.querySelector("#sendMotorButton");
const customCommandForm = document.querySelector("#customCommandForm");
const customCommandInput = document.querySelector("#customCommandInput");
const logOutput = document.querySelector("#logOutput");
const clearLogButton = document.querySelector("#clearLogButton");
const themeToggleButton = document.querySelector("#themeToggleButton");
const altitudeCanvas = document.querySelector("#altitudeCanvas");
const attitudeCanvas = document.querySelector("#attitudeCanvas");
const headingCanvas = document.querySelector("#headingCanvas");
const attitudeStatus = document.querySelector("#attitudeStatus");
const headingValue = document.querySelector("#headingValue");
const rollPlotValue = document.querySelector("#rollPlotValue");
const pitchPlotValue = document.querySelector("#pitchPlotValue");
const yawPlotValue = document.querySelector("#yawPlotValue");
const rollPlotCanvas = document.querySelector("#rollPlotCanvas");
const pitchPlotCanvas = document.querySelector("#pitchPlotCanvas");
const yawPlotCanvas = document.querySelector("#yawPlotCanvas");

let visibleLogs = [];
let hiddenLogCount = 0;
let statusEvents = null;
let lastPlottedAttitudeAt = null;
const MAX_VISIBLE_LOGS = 12;
const THEME_STORAGE_KEY = "gcs-theme";
const PLOT_VISIBILITY_STORAGE_KEY = "gcs-plot-visibility";
const altitudeTape = new AltitudeTape(altitudeCanvas);
const attitudeIndicator = new AttitudeIndicator(attitudeCanvas);
const headingIndicator = new HeadingIndicator(headingCanvas);
const attitudePlots = {
  roll: new RealtimeLinePlot(rollPlotCanvas, { label: "roll", unit: "deg", colorVar: "--plot-roll" }),
  pitch: new RealtimeLinePlot(pitchPlotCanvas, { label: "pitch", unit: "deg", colorVar: "--plot-pitch" }),
  yaw: new RealtimeLinePlot(yawPlotCanvas, { label: "yaw", unit: "deg", colorVar: "--plot-yaw" }),
};
const plotToggleInputs = document.querySelectorAll("[data-plot-toggle]");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function setMessage(text, kind = "") {
  messageText.textContent = text;
  messageText.dataset.kind = kind;
}

function setConnectedUi(status) {
  const connected = Boolean(status.connected);
  connectionText.textContent = connected
    ? `Connected: ${status.port} @ ${status.baud}`
    : "Disconnected";
  document.body.dataset.connected = connected ? "true" : "false";
}

function applyTheme(theme) {
  const normalizedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = normalizedTheme;
  themeToggleButton.title = normalizedTheme === "light" ? "Switch to dark mode" : "Switch to light mode";
  themeToggleButton.setAttribute("aria-checked", normalizedTheme === "dark" ? "true" : "false");
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    // Theme persistence is optional; the UI can still switch for the current page.
  }
}

function loadPlotVisibility() {
  try {
    return JSON.parse(localStorage.getItem(PLOT_VISIBILITY_STORAGE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function savePlotVisibility() {
  const visibility = {};
  plotToggleInputs.forEach((input) => {
    visibility[input.dataset.plotToggle] = input.checked;
  });

  try {
    localStorage.setItem(PLOT_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch (error) {
    // Plot visibility persistence is optional.
  }
}

function setPlotVisibility(name, visible, persist = true) {
  const card = document.querySelector(`[data-plot-card="${name}"]`);
  const input = document.querySelector(`[data-plot-toggle="${name}"]`);

  if (card) {
    card.hidden = !visible;
  }
  if (input) {
    input.checked = visible;
  }
  if (visible && attitudePlots[name]) {
    requestAnimationFrame(() => attitudePlots[name].resize());
  }
  if (persist) {
    savePlotVisibility();
  }
}

function bindPlotToggles() {
  const storedVisibility = loadPlotVisibility();
  plotToggleInputs.forEach((input) => {
    const name = input.dataset.plotToggle;
    const visible = Object.prototype.hasOwnProperty.call(storedVisibility, name)
      ? Boolean(storedVisibility[name])
      : input.checked;

    setPlotVisibility(name, visible, false);
    input.addEventListener("change", () => {
      setPlotVisibility(name, input.checked);
    });
  });
}

function renderLogs(logs) {
  if (hiddenLogCount > logs.length) {
    hiddenLogCount = logs.length;
  }

  visibleLogs = logs.slice(hiddenLogCount).slice(-MAX_VISIBLE_LOGS);
  logOutput.textContent = visibleLogs
    .map((item) => `[${item.time}] ${item.direction.toUpperCase()} ${item.message}`)
    .join("\n");
  logOutput.scrollTop = logOutput.scrollHeight;
}

function renderAttitude(attitude) {
  attitudeIndicator.setTarget(attitude);
  headingIndicator.setTarget(attitude);
  const valid = Boolean(attitude && attitude.valid);
  const roll = valid ? Number(attitude.roll) : 0;
  const pitch = valid ? Number(attitude.pitch) : 0;
  const yaw = valid ? Number(attitude.yaw) : 0;
  const heading = normalizeDegrees(yaw);

  attitudeStatus.textContent = valid ? "IMU Live" : "No IMU";
  attitudeStatus.dataset.live = valid ? "true" : "false";
  headingValue.textContent = valid ? `${heading.toFixed(2)} deg` : "--- deg";
  rollPlotValue.textContent = `${roll.toFixed(2)} deg`;
  pitchPlotValue.textContent = `${pitch.toFixed(2)} deg`;
  yawPlotValue.textContent = `${yaw.toFixed(2)} deg`;

  if (valid) {
    const updatedAt = Number(attitude.updated_at);
    const sampleTime = Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now() / 1000;
    if (lastPlottedAttitudeAt !== sampleTime) {
      lastPlottedAttitudeAt = sampleTime;
      attitudePlots.roll.addSample(sampleTime, roll);
      attitudePlots.pitch.addSample(sampleTime, pitch);
      attitudePlots.yaw.addSample(sampleTime, yaw);
    }
  }
}

function renderAltitude(altitude) {
  altitudeTape.setTarget(altitude);
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

async function refreshPorts() {
  const selected = portSelect.value;
  const payload = await api("/api/ports");
  portSelect.innerHTML = "";

  if (payload.ports.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No ports";
    portSelect.append(option);
    return;
  }

  for (const port of payload.ports) {
    const option = document.createElement("option");
    option.value = port;
    option.textContent = port;
    portSelect.append(option);
  }

  if (selected && payload.ports.includes(selected)) {
    portSelect.value = selected;
  }
}

async function refreshStatus() {
  const status = await api("/api/status");
  renderStatus(status);
}

function renderStatus(status) {
  setConnectedUi(status);
  renderLogs(status.logs);
  renderAttitude(status.attitude);
  renderAltitude(status.altitude);
}

function connectStatusStream() {
  if (statusEvents !== null) {
    statusEvents.close();
  }

  statusEvents = new EventSource("/api/events");
  statusEvents.onmessage = (event) => {
    renderStatus(JSON.parse(event.data));
  };
  statusEvents.onerror = () => {
    setMessage("Realtime stream reconnecting...", "error");
  };
  statusEvents.onopen = () => {
    if (messageText.textContent === "Realtime stream reconnecting...") {
      setMessage("");
    }
  };
}

async function connectSerial() {
  setMessage("");
  const port = portSelect.value;
  const baud = Number(baudInput.value || 115200);
  const payload = await api("/api/connect", {
    method: "POST",
    body: JSON.stringify({ port, baud }),
  });
  setConnectedUi(payload.status);
  setMessage("Connected", "ok");
}

async function disconnectSerial() {
  const payload = await api("/api/disconnect", { method: "POST", body: "{}" });
  setConnectedUi(payload.status);
  setMessage("Disconnected", "ok");
}

async function sendCommand(command) {
  setMessage("");
  await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command }),
  });
  setMessage(`Sent: ${command}`, "ok");
  await refreshStatus();
}

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await sendCommand(button.dataset.command);
    } catch (error) {
      setMessage(error.message, "error");
    }
  });
});

refreshPortsButton.addEventListener("click", async () => {
  try {
    await refreshPorts();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

connectButton.addEventListener("click", async () => {
  try {
    await connectSerial();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

disconnectButton.addEventListener("click", async () => {
  try {
    await disconnectSerial();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

sendPwmButton.addEventListener("click", async () => {
  try {
    await sendCommand(`pwm ${pwmInput.value}`);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

sendMotorButton.addEventListener("click", async () => {
  try {
    await sendCommand(`mt ${pwmInput.value}`);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

customCommandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await sendCommand(customCommandInput.value);
    customCommandInput.value = "";
  } catch (error) {
    setMessage(error.message, "error");
  }
});

clearLogButton.addEventListener("click", () => {
  hiddenLogCount += visibleLogs.length;
  visibleLogs = [];
  logOutput.textContent = "";
});

themeToggleButton.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(nextTheme);
  saveTheme(nextTheme);
  Object.values(attitudePlots).forEach((plot) => plot.scheduleDraw());
});

async function boot() {
  try {
    await refreshPorts();
    await refreshStatus();
    connectStatusStream();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

applyTheme(document.documentElement.dataset.theme);
bindPlotToggles();
boot();
