const portSelect = document.querySelector("#portSelect");
const baudInput = document.querySelector("#baudInput");
const connectButton = document.querySelector("#connectButton");
const disconnectButton = document.querySelector("#disconnectButton");
const refreshPortsButton = document.querySelector("#refreshPortsButton");
const connectionText = document.querySelector("#connectionText");
const messageText = document.querySelector("#messageText");
const pwmInput = document.querySelector("#pwmInput");
const altitudeTargetInput = document.querySelector("#altitudeTargetInput");
const sendPwmButton = document.querySelector("#sendPwmButton");
const sendAltitudeButton = document.querySelector("#sendAltitudeButton");
const sendMotorButton = document.querySelector("#sendMotorButton");
const landButton = document.querySelector("#landButton");
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
const ekfStatus = document.querySelector("#ekfStatus");
const trajectoryCanvas = document.querySelector("#trajectoryCanvas");
const trajectoryXValue = document.querySelector("#trajectoryXValue");
const trajectoryYValue = document.querySelector("#trajectoryYValue");
const trajectoryCovXValue = document.querySelector("#trajectoryCovXValue");
const trajectoryCovYValue = document.querySelector("#trajectoryCovYValue");
const trajectoryCovZValue = document.querySelector("#trajectoryCovZValue");
const velocityPlotCanvas = document.querySelector("#velocityPlotCanvas");
const velocityXValue = document.querySelector("#velocityXValue");
const velocityYValue = document.querySelector("#velocityYValue");
const velocityZValue = document.querySelector("#velocityZValue");
const gpsStatus = document.querySelector("#gpsStatus");
const gpsNedNValue = document.querySelector("#gpsNedNValue");
const gpsNedEValue = document.querySelector("#gpsNedEValue");
const gpsNedDValue = document.querySelector("#gpsNedDValue");
const gpsSigmaNValue = document.querySelector("#gpsSigmaNValue");
const gpsSigmaEValue = document.querySelector("#gpsSigmaEValue");
const gpsSigmaDValue = document.querySelector("#gpsSigmaDValue");
const gpsLatValue = document.querySelector("#gpsLatValue");
const gpsLonValue = document.querySelector("#gpsLonValue");
const gpsHmslValue = document.querySelector("#gpsHmslValue");
const gpsOriginValue = document.querySelector("#gpsOriginValue");

let visibleLogs = [];
let hiddenLogCount = 0;
let statusEvents = null;
let lastPlottedAttitudeAt = null;
let lastPlottedEkfAt = null;
let landingRunId = 0;
let landingActive = false;
const MAX_VISIBLE_LOGS = 12;
const LAND_TARGET_PWM = 1400;
const LAND_STEP_PWM = 30;
const LAND_STEP_INTERVAL_MS = 700;
const THEME_STORAGE_KEY = "gcs-theme";
const PLOT_VISIBILITY_STORAGE_KEY = "gcs-plot-visibility";
const VELOCITY_VISIBILITY_STORAGE_KEY = "gcs-velocity-visibility";
const altitudeTape = new AltitudeTape(altitudeCanvas);
const attitudeIndicator = new AttitudeIndicator(attitudeCanvas);
const headingIndicator = new HeadingIndicator(headingCanvas);
const attitudePlots = {
  roll: new RealtimeLinePlot(rollPlotCanvas, { label: "roll", unit: "deg", colorVar: "--plot-roll" }),
  pitch: new RealtimeLinePlot(pitchPlotCanvas, { label: "pitch", unit: "deg", colorVar: "--plot-pitch" }),
  yaw: new RealtimeLinePlot(yawPlotCanvas, { label: "yaw", unit: "deg", colorVar: "--plot-yaw" }),
};
const trajectoryPlot = new TrajectoryPlot(trajectoryCanvas, { label: "EKF trajectory" });
const velocityPlot = new RealtimeMultiLinePlot(velocityPlotCanvas, {
  label: "EKF velocity",
  unit: "m/s",
  series: [
    { key: "x", label: "X", colorVar: "--plot-x" },
    { key: "y", label: "Y", colorVar: "--plot-y" },
    { key: "z", label: "Z", colorVar: "--plot-z" },
  ],
});
const plotToggleInputs = document.querySelectorAll("[data-plot-toggle]");
const velocityToggleInputs = document.querySelectorAll("[data-velocity-toggle]");

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

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

function loadVelocityVisibility() {
  try {
    return JSON.parse(localStorage.getItem(VELOCITY_VISIBILITY_STORAGE_KEY) || "{}");
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

function saveVelocityVisibility() {
  const visibility = {};
  velocityToggleInputs.forEach((input) => {
    visibility[input.dataset.velocityToggle] = input.checked;
  });

  try {
    localStorage.setItem(VELOCITY_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch (error) {
    // Velocity visibility persistence is optional.
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

function setVelocityVisibility(name, visible, persist = true) {
  const input = document.querySelector(`[data-velocity-toggle="${name}"]`);
  if (input) {
    input.checked = visible;
  }

  velocityPlot.setSeriesVisible(name, visible);

  if (persist) {
    saveVelocityVisibility();
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

function bindVelocityToggles() {
  const storedVisibility = loadVelocityVisibility();
  velocityToggleInputs.forEach((input) => {
    const name = input.dataset.velocityToggle;
    const defaultVisible = name !== "z";
    const visible = Object.prototype.hasOwnProperty.call(storedVisibility, name)
      ? Boolean(storedVisibility[name])
      : defaultVisible;

    setVelocityVisibility(name, visible, false);
    input.addEventListener("change", () => {
      setVelocityVisibility(name, input.checked);
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

function renderEkf(ekf) {
  const valid = Boolean(ekf && ekf.valid);
  const position = valid && ekf.position ? ekf.position : {};
  const velocity = valid && ekf.velocity ? ekf.velocity : {};
  const covarianceValid = Boolean(ekf && ekf.covariance_valid);
  const positionCovariance = covarianceValid && ekf.position_covariance ? ekf.position_covariance : {};
  const positionX = Number(position.x);
  const positionY = Number(position.y);
  const covarianceX = Number(positionCovariance.x);
  const covarianceY = Number(positionCovariance.y);
  const covarianceZ = Number(positionCovariance.z);
  const velocityX = Number(velocity.x);
  const velocityY = Number(velocity.y);
  const velocityZ = Number(velocity.z);

  ekfStatus.textContent = valid ? "EKF Live" : "No EKF";
  ekfStatus.dataset.live = valid ? "true" : "false";

  trajectoryXValue.textContent = valid && Number.isFinite(positionX) ? `${positionX.toFixed(2)} m` : "--- m";
  trajectoryYValue.textContent = valid && Number.isFinite(positionY) ? `${positionY.toFixed(2)} m` : "--- m";
  trajectoryCovXValue.textContent = formatStdDev(covarianceX, covarianceValid);
  trajectoryCovYValue.textContent = formatStdDev(covarianceY, covarianceValid);
  trajectoryCovZValue.textContent = formatStdDev(covarianceZ, covarianceValid);
  velocityXValue.textContent = valid && Number.isFinite(velocityX) ? `${velocityX.toFixed(2)} m/s` : "--- m/s";
  velocityYValue.textContent = valid && Number.isFinite(velocityY) ? `${velocityY.toFixed(2)} m/s` : "--- m/s";
  velocityZValue.textContent = valid && Number.isFinite(velocityZ) ? `${velocityZ.toFixed(2)} m/s` : "--- m/s";

  if (!valid) {
    return;
  }

  const updatedAt = Number(ekf.updated_at);
  const sampleTime = Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now() / 1000;
  if (lastPlottedEkfAt === sampleTime) {
    return;
  }

  lastPlottedEkfAt = sampleTime;
  trajectoryPlot.addSample(sampleTime, positionX, positionY);
  velocityPlot.addSample(sampleTime, { x: velocityX, y: velocityY, z: velocityZ });
}

function renderGnss(gnss) {
  const valid = Boolean(gnss && gnss.valid);
  const hasSample = Boolean(gnss && Number(gnss.updated_at) > 0);
  const position = valid && gnss.position ? gnss.position : {};
  const llh = hasSample && gnss.llh ? gnss.llh : {};
  const covarianceValid = Boolean(gnss && gnss.covariance_valid);
  const positionCovariance = covarianceValid && gnss.position_covariance ? gnss.position_covariance : {};
  const origin = gnss && gnss.origin ? gnss.origin : null;
  const fixType = gnss ? Number(gnss.fix_type) : 0;

  gpsStatus.textContent = valid ? `Fix ${fixType}` : "No GPS";
  gpsStatus.dataset.live = valid ? "true" : "false";

  gpsNedNValue.textContent = formatMeters(position.x, valid);
  gpsNedEValue.textContent = formatMeters(position.y, valid);
  gpsNedDValue.textContent = formatMeters(position.z, valid);
  gpsSigmaNValue.textContent = formatStdDev(Number(positionCovariance.x), covarianceValid);
  gpsSigmaEValue.textContent = formatStdDev(Number(positionCovariance.y), covarianceValid);
  gpsSigmaDValue.textContent = formatStdDev(Number(positionCovariance.z), covarianceValid);
  gpsLatValue.textContent = formatDegrees(llh.lat, hasSample);
  gpsLonValue.textContent = formatDegrees(llh.lon, hasSample);
  gpsHmslValue.textContent = formatMeters(llh.hmsl, hasSample);
  gpsOriginValue.textContent = origin
    ? `${Number(origin.lat).toFixed(7)}, ${Number(origin.lon).toFixed(7)}`
    : "---";
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function formatMeters(value, valid) {
  const numeric = Number(value);
  return valid && Number.isFinite(numeric) ? `${numeric.toFixed(2)} m` : "--- m";
}

function formatDegrees(value, valid) {
  const numeric = Number(value);
  return valid && Number.isFinite(numeric) ? `${numeric.toFixed(7)} deg` : "--- deg";
}

function formatStdDev(covariance, valid) {
  if (!valid || !Number.isFinite(covariance) || covariance < 0) {
    return "--- m";
  }

  return `${Math.sqrt(covariance).toFixed(2)} m`;
}

function readPwmInput() {
  const rawValue = Number(pwmInput.value);
  if (!Number.isFinite(rawValue)) {
    throw new Error("PWM must be a number");
  }

  const min = Number(pwmInput.min || 1000);
  const max = Number(pwmInput.max || 2000);
  const pwm = Math.round(rawValue);
  if (pwm < min || pwm > max) {
    throw new Error(`PWM must be between ${min} and ${max}`);
  }

  return pwm;
}

function readAltitudeTargetCm() {
  const rawValue = Number(altitudeTargetInput.value);
  if (!Number.isFinite(rawValue)) {
    throw new Error("Target altitude must be a number of centimeters");
  }

  const min = Number(altitudeTargetInput.min || -500);
  const max = Number(altitudeTargetInput.max || 2000);
  const altitudeCm = Math.round(rawValue);
  if (altitudeCm < min || altitudeCm > max) {
    throw new Error(`Target altitude must be between ${min} cm and ${max} cm`);
  }

  return altitudeCm;
}

function setLandingActive(active) {
  landingActive = active;
  landButton.disabled = active;
}

function cancelLandingSequence() {
  if (!landingActive) {
    return;
  }

  landingRunId += 1;
  setLandingActive(false);
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
  renderEkf(status.ekf);
  renderGnss(status.gnss);
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
  cancelLandingSequence();
  const payload = await api("/api/disconnect", { method: "POST", body: "{}" });
  setConnectedUi(payload.status);
  setMessage("Disconnected", "ok");
}

async function postCommand(command) {
  await api("/api/command", {
    method: "POST",
    body: JSON.stringify({ command }),
  });
}

async function sendCommand(command) {
  cancelLandingSequence();
  setMessage("");
  await postCommand(command);
  setMessage(`Sent: ${command}`, "ok");
  await refreshStatus();
}

async function sendPwmValue(pwm) {
  await postCommand(`pwm ${pwm}`);
  pwmInput.value = String(pwm);
}

async function sendAltitudeTargetValue(altitudeCm) {
  cancelLandingSequence();
  const roundedAltitudeCm = Math.round(altitudeCm);
  await postCommand(`alt ${roundedAltitudeCm}`);
  altitudeTargetInput.value = String(roundedAltitudeCm);
}

async function runLandingSequence() {
  cancelLandingSequence();

  if (document.body.dataset.connected !== "true") {
    throw new Error("Serial port is not connected");
  }

  const startPwm = readPwmInput();
  if (startPwm <= LAND_TARGET_PWM) {
    setMessage(`Land target already reached: ${startPwm} PWM`, "ok");
    return;
  }

  const runId = landingRunId + 1;
  landingRunId = runId;
  setLandingActive(true);
  setMessage(`Landing: ${startPwm} -> ${LAND_TARGET_PWM} PWM`, "ok");

  try {
    const values = [];
    for (let pwm = startPwm; pwm > LAND_TARGET_PWM; pwm -= LAND_STEP_PWM) {
      values.push(pwm);
    }
    if (values[values.length - 1] !== LAND_TARGET_PWM) {
      values.push(LAND_TARGET_PWM);
    }

    for (let index = 0; index < values.length; index += 1) {
      if (runId !== landingRunId) {
        return;
      }

      const pwm = values[index];
      await sendPwmValue(pwm);
      setMessage(`Landing: pwm ${pwm}`, "ok");

      if (index < values.length - 1) {
        await delay(LAND_STEP_INTERVAL_MS);
      }
    }

    setMessage(`Landing complete: pwm ${LAND_TARGET_PWM}`, "ok");
    await refreshStatus();
  } finally {
    if (runId === landingRunId) {
      setLandingActive(false);
    }
  }
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
    await sendCommand(`pwm ${readPwmInput()}`);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

sendAltitudeButton.addEventListener("click", async () => {
  try {
    const altitudeCm = readAltitudeTargetCm();
    await sendAltitudeTargetValue(altitudeCm);
    setMessage(`Sent AltHold target: ${altitudeCm} cm`, "ok");
    await refreshStatus();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

sendMotorButton.addEventListener("click", async () => {
  try {
    await sendCommand(`mt ${readPwmInput()}`);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

landButton.addEventListener("click", async () => {
  try {
    await runLandingSequence();
  } catch (error) {
    setLandingActive(false);
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
  trajectoryPlot.scheduleDraw();
  velocityPlot.scheduleDraw();
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
bindVelocityToggles();
boot();
