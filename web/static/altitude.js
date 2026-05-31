class AltitudeTape {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.target = { meters: 0, valid: false };
    this.currentMeters = 0;
    this.pixelRatio = window.devicePixelRatio || 1;
    this.responseFactor = 0.22;
    this.currentScale = null;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame(() => this.frame());
  }

  setTarget(altitude) {
    if (!altitude) {
      this.target = { meters: 0, valid: false };
      return;
    }

    const meters = Number(altitude.meters);
    this.target = {
      meters: Number.isFinite(meters) ? meters : 0,
      valid: Boolean(altitude.valid),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(150, Math.floor(rect.width));
    const height = Math.max(180, Math.floor(rect.height));
    this.pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.width = width;
    this.height = height;
  }

  frame() {
    if (this.target.valid) {
      this.currentMeters += (this.target.meters - this.currentMeters) * this.responseFactor;
    }

    this.draw();
    requestAnimationFrame(() => this.frame());
  }

  draw() {
    const ctx = this.ctx;
    const width = this.width || 150;
    const height = this.height || 180;
    const current = this.target.valid ? this.currentMeters : 0;
    const centerY = height / 2;
    const compact = height < 320;
    const verticalPadding = compact ? 10 : 18;
    const scale = this.scaleForAltitude(current, height, verticalPadding, compact);
    const pixelsPerMeter = scale.pixelsPerMeter;
    const minorStep = scale.minorStep;
    const majorStep = scale.majorStep;
    const markerValue = this.target.valid ? this.target.meters : null;
    const markerLabel = this.formatValue(markerValue);
    const markerFont = "750 13px Segoe UI, Arial, sans-serif";
    ctx.font = markerFont;
    const markerLabelWidth = ctx.measureText(markerLabel).width;
    const markerSpace = width >= 180 ? Math.min(width - 64, Math.max(74, markerLabelWidth + 58)) : 48;
    const tickEnd = Math.max(width >= 180 ? 64 : 88, width - markerSpace);
    const majorStart = Math.max(44, tickEnd - Math.min(82, width * 0.4));
    const minorStart = Math.min(tickEnd - 16, Math.max(majorStart + 24, tickEnd - 46));
    const labelX = majorStart - 10;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.css("--bg", "#101318");
    ctx.fillRect(0, 0, width, height);

    this.drawTicks(ctx, {
      current,
      centerY,
      height,
      verticalPadding,
      pixelsPerMeter,
      minorStep,
      majorStep,
      tickEnd,
      majorStart,
      minorStart,
      labelX,
      labelDecimals: scale.labelDecimals,
    });

    this.drawMarker(ctx, {
      width,
      centerY,
      tickEnd,
      label: markerLabel,
      font: markerFont,
    });

  }

  scaleForAltitude(current, height, verticalPadding, compact) {
    const usableHeight = Math.max(120, height - verticalPadding * 2);
    const visibleSpan = this.visibleSpanForAltitude(current);
    const targetPixelsPerMeter = usableHeight / visibleSpan;

    if (this.currentScale === null) {
      this.currentScale = targetPixelsPerMeter;
    } else {
      this.currentScale += (targetPixelsPerMeter - this.currentScale) * 0.12;
    }

    const effectiveSpan = usableHeight / this.currentScale;
    const majorStep = this.niceStep(effectiveSpan / (compact ? 5 : 6));
    const minorStep = majorStep / 5;

    return {
      pixelsPerMeter: this.currentScale,
      majorStep,
      minorStep,
      labelDecimals: this.decimalsForStep(majorStep),
    };
  }

  visibleSpanForAltitude(current) {
    const absoluteMeters = Math.abs(current);
    const minimumSpan = 2.5;
    const desiredSpan = Math.max(minimumSpan, absoluteMeters * 0.8 + minimumSpan);
    return Math.min(250, this.niceCeil(desiredSpan));
  }

  niceCeil(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return 2.5;
    }

    const exponent = Math.floor(Math.log10(value));
    const base = 10 ** exponent;
    const fraction = value / base;
    const steps = [1, 1.5, 2, 2.5, 3, 5, 7.5, 10];

    for (const step of steps) {
      if (fraction <= step) {
        return step * base;
      }
    }

    return 10 * base;
  }

  niceStep(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return 1;
    }

    const exponent = Math.floor(Math.log10(value));
    const base = 10 ** exponent;
    const fraction = value / base;
    const steps = [1, 2, 2.5, 5, 10];

    for (const step of steps) {
      if (fraction <= step) {
        return step * base;
      }
    }

    return 10 * base;
  }

  decimalsForStep(step) {
    if (!Number.isFinite(step)) {
      return 0;
    }

    for (let decimals = 0; decimals <= 3; decimals += 1) {
      const scale = 10 ** decimals;
      if (Math.abs(Math.round(step * scale) - step * scale) < 1e-6) {
        return decimals;
      }
    }

    return 3;
  }

  drawTicks(ctx, layout) {
    const {
      current,
      centerY,
      height,
      verticalPadding,
      pixelsPerMeter,
      minorStep,
      majorStep,
      tickEnd,
      majorStart,
      minorStart,
      labelX,
      labelDecimals,
    } = layout;
    const minAltitude = current - (centerY - verticalPadding) / pixelsPerMeter - minorStep;
    const maxAltitude = current + (height - centerY - verticalPadding) / pixelsPerMeter + minorStep;
    const firstTickIndex = Math.floor(minAltitude / minorStep);
    const lastTickIndex = Math.ceil(maxAltitude / minorStep);
    const tickColor = this.css("--altitude-tick", "#58c7e8");
    const mutedTickColor = this.css("--altitude-tick-muted", "rgba(88, 199, 232, 0.38)");
    const labelColor = this.css("--text", "#eef3f8");

    ctx.save();
    ctx.lineCap = "square";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let tickIndex = firstTickIndex; tickIndex <= lastTickIndex; tickIndex += 1) {
      const altitude = tickIndex * minorStep;
      const y = centerY - (altitude - current) * pixelsPerMeter;
      if (y < verticalPadding || y > height - verticalPadding) {
        continue;
      }

      const isMajor = Math.abs(altitude / majorStep - Math.round(altitude / majorStep)) < 1e-6;
      const isZero = Math.abs(altitude) < minorStep * 0.5;
      ctx.strokeStyle = isMajor || isZero ? tickColor : mutedTickColor;
      ctx.lineWidth = isZero ? 2.5 : isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(isMajor || isZero ? majorStart : minorStart, y);
      ctx.lineTo(tickEnd, y);
      ctx.stroke();

      if (isMajor || isZero) {
        ctx.fillStyle = labelColor;
        ctx.font = "650 11px Segoe UI, Arial, sans-serif";
        ctx.fillText(this.formatTickValue(altitude, labelDecimals), labelX, y);
      }
    }

    ctx.strokeStyle = this.css("--altitude-tick-muted", "rgba(88, 199, 232, 0.38)");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tickEnd, verticalPadding);
    ctx.lineTo(tickEnd, height - verticalPadding);
    ctx.stroke();
    ctx.restore();
  }

  drawMarker(ctx, layout) {
    const { width, centerY, tickEnd, label, font } = layout;
    const markerColor = this.css("--altitude-marker", "#126e8d");
    const markerStroke = this.css("--altitude-marker-stroke", "#06151d");
    const textColor = this.css("--altitude-marker-text", "#eaf8ff");
    const tipX = tickEnd + 8;
    const sideValue = width >= 180;
    const baseX = Math.min(width - (sideValue ? 48 : 10), tipX + 30);
    const textX = sideValue ? width - 8 : width / 2;
    const textMaxWidth = sideValue ? Math.max(32, width - baseX - 16) : Math.max(32, width - 16);

    ctx.save();
    ctx.strokeStyle = markerColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tickEnd - 48, centerY);
    ctx.lineTo(tipX, centerY);
    ctx.stroke();

    ctx.fillStyle = markerColor;
    ctx.strokeStyle = markerStroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tipX, centerY);
    ctx.lineTo(baseX, centerY - 16);
    ctx.lineTo(baseX, centerY + 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = font;
    ctx.textAlign = sideValue ? "right" : "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, textX, sideValue ? centerY : centerY + 42, textMaxWidth);
    ctx.restore();
  }

  formatValue(value) {
    if (value === null || !Number.isFinite(value)) {
      return "--- m";
    }

    return `${value.toFixed(2)} m`;
  }

  formatTickValue(value, decimals) {
    if (Math.abs(value) < 1e-9) {
      return "0";
    }

    return value.toFixed(decimals);
  }

  css(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
}
