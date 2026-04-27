import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import aquantLogoUrl from "./assets/aquant-logo.png";
import arialBoldUrl from "./assets/arialbd.ttf";
import arialRegularUrl from "./assets/arial.ttf";
import kohlerLogoUrl from "./assets/kohler-logo.png";
import plumberLogoUrl from "./assets/plumber-logo.png";
import shreejiLogoUrl from "./assets/shreeji_logo.png";
import shreejiWatermarkUrl from "./assets/shreeji-watermark.png";

const GST_RATE = 18;
const RUPEE = "\u20B9";
const CUSTOM_FONT = "ShreejiArial";
const DEFAULT_PUBLIC_ASSET_BASE = "https://shriji-tiles.onrender.com";

const PAGE = {
  width: 210,
  height: 297,
  bottom: 284,
  footerY: 294.2,
};

const COLORS = {
  ink: [32, 45, 64],
  navy: [31, 61, 103],
  gold: [216, 157, 33],
  red: [190, 30, 45],
  grid: [215, 222, 232],
  headerFill: [248, 250, 252],
  finalFill: [244, 247, 251],
  muted: [86, 101, 120],
  black: [0, 0, 0],
  white: [255, 255, 255],
};

const TABLE = {
  left: 11.16,
  right: 198.84,
  width: 187.68,
  columns: [7.06, 14.81, 59.98, 16.93, 17.64, 10.58, 20.46, 13.76, 26.46],
  bodyMinHeight: 20.86,
  headerHeight: 9.0,
  totalHeight: 8.9,
  lineWidth: 0.12,
};

const WATERMARK = {
  width: 148,
  height: 88.8,
  opacity: 0.03,
};

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeNumberFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

function setTextColor(doc, color) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function setFillColor(doc, color) {
  doc.setFillColor(color[0], color[1], color[2]);
}

function setDrawColor(doc, color) {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function coerceNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return `${RUPEE} ${currencyFormatter.format(coerceNumber(value))}`;
}

function formatWholeCurrency(value) {
  return `${RUPEE} ${wholeNumberFormatter.format(coerceNumber(value))}/-`;
}

function formatPercent(value) {
  const number = coerceNumber(value);
  if (Math.abs(number - Math.round(number)) < 0.001) {
    return `${Math.round(number)}%`;
  }
  return `${number.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function toValidDate(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function formatFileDate(value) {
  const date = toValidDate(value);
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join("-");
}

function formatDisplayDate(value) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return formatter.format(toValidDate(value));
}

function slugFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function getClientInfo(payload) {
  return payload.clientInfo || payload.client_info || payload.client || {};
}

function buildFileName(value, clientName = "") {
  const cleanClient = slugFilePart(clientName);
  return `Quotation_Shreeji_Ceramica${cleanClient ? `_${cleanClient}` : ""}_${formatFileDate(value)}.pdf`;
}

function normalizeRoomList(roomValue) {
  const rawRooms = Array.isArray(roomValue) ? roomValue : [roomValue];
  const seen = new Set();
  const rooms = [];

  rawRooms
    .flatMap((value) => String(value || "").split(/[|,]/g))
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((room) => {
      const key = room.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        rooms.push(room);
      }
    });

  return rooms.length ? rooms : ["Unassigned Room"];
}

function normalizeProduct(item, index) {
  const qty = Math.max(0, coerceNumber(item.qty ?? item.quantity ?? 0));
  const rate = Math.max(0, coerceNumber(item.rate ?? item.price ?? 0));
  const discount = Math.min(100, Math.max(0, coerceNumber(item.discount ?? item.discountPercent ?? 0)));
  const calculatedAmount = qty * rate * (1 - discount / 100);
  const hasAmount = item.amount !== undefined && item.amount !== null && item.amount !== "";
  const amount = hasAmount ? coerceNumber(item.amount) : calculatedAmount;

  return {
    id: String(item.id ?? `${item.sku || item.code || "item"}-${index}`),
    name: String(item.name ?? item.itemName ?? item.productName ?? "Product").trim(),
    details: String(item.details ?? item.description ?? item.productDetails ?? "").trim(),
    color: String(item.color ?? item.finish ?? "").trim(),
    source: String(item.source ?? item.brand ?? item.catalog ?? "").trim(),
    sku: String(item.sku ?? item.code ?? item.itemCode ?? "-").trim() || "-",
    size: String(item.size ?? item.dimension ?? "-").trim() || "-",
    qty,
    rate,
    discount,
    amount: Math.max(0, amount),
    image: String(item.image ?? item.imageUrl ?? item.photo ?? item.thumbnail ?? "").trim(),
    mrp: coerceNumber(item.mrp ?? item.rate ?? item.price ?? rate),
    rooms: normalizeRoomList(item.room ?? item.rooms ?? item.area),
  };
}

function groupByRoom(products) {
  const grouped = new Map();

  products.forEach((item) => {
    item.rooms.forEach((room) => {
      if (!grouped.has(room)) {
        grouped.set(room, []);
      }
      grouped.get(room).push(item);
    });
  });

  return grouped;
}

function isJsdomRuntime() {
  return (
    typeof navigator !== "undefined" && /jsdom/i.test(String(navigator.userAgent || ""))
  );
}

function browserCanRasterize() {
  const isJsdom = isJsdomRuntime();

  return typeof document !== "undefined" && typeof Image !== "undefined" && !isJsdom;
}

function makeCanvas(width, height) {
  if (!browserCanRasterize()) {
    return null;
  }

  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return null;
  }

  ctx.scale(ratio, ratio);
  return { canvas, ctx };
}

function createProductPlaceholderAsset(label = "Product") {
  const surface = makeCanvas(320, 240);
  if (!surface) {
    return null;
  }

  const { canvas, ctx } = surface;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 320, 240);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(14, 14, 292, 212);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, 292, 212);
  ctx.fillStyle = "#64748b";
  ctx.font = "700 24px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PRODUCT IMAGE", 160, 122);
  ctx.font = "500 18px Arial, sans-serif";
  ctx.fillText(String(label).slice(0, 30), 160, 154);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.9),
    format: "JPEG",
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read blob"));
    reader.readAsDataURL(blob);
  });
}

function normalizePublicAssetBase(baseUrl) {
  const raw = String(baseUrl || "").trim() || DEFAULT_PUBLIC_ASSET_BASE;
  try {
    return new URL(raw).origin;
  } catch (error) {
    return DEFAULT_PUBLIC_ASSET_BASE;
  }
}

function isLocalHost(hostname) {
  return /^(localhost|127\.0\.0\.1|::1)$/i.test(String(hostname || "").trim());
}

function normalizeImageSource(src, publicAssetBase) {
  const raw = String(src || "").trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("data:image/") || raw.startsWith("blob:")) {
    return raw;
  }

  const base = normalizePublicAssetBase(publicAssetBase);

  try {
    const absolute = new URL(raw, base);
    if (!["http:", "https:"].includes(absolute.protocol)) {
      return "";
    }

    const baseHost = new URL(base).hostname;
    if (isLocalHost(absolute.hostname) && !isLocalHost(baseHost)) {
      return `${base}${absolute.pathname}${absolute.search}${absolute.hash}`;
    }

    return absolute.toString();
  } catch (error) {
    return "";
  }
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const result = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

async function urlToDataUrl(src) {
  if (!src) {
    throw new Error("Missing image source");
  }

  if (src.startsWith("data:image/")) {
    return src;
  }

  if (isJsdomRuntime() || typeof fetch !== "function") {
    throw new Error("Fetch API unavailable");
  }

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Asset request failed: ${response.status}`);
  }

  return blobToDataUrl(await response.blob());
}

function imageFormatFromDataUrl(dataUrl) {
  const type = String(dataUrl).match(/^data:image\/([^;,]+)/i)?.[1]?.toLowerCase();

  if (type === "png") {
    return "PNG";
  }
  if (type === "webp") {
    return "WEBP";
  }
  return "JPEG";
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.crossOrigin = "anonymous";
    image.src = src;
  });
}

async function rasterizeImage(dataUrl, width, height, outputType = "image/jpeg") {
  if (!browserCanRasterize()) {
    return {
      dataUrl,
      format: imageFormatFromDataUrl(dataUrl),
    };
  }

  const surface = makeCanvas(width, height);
  if (!surface) {
    return {
      dataUrl,
      format: imageFormatFromDataUrl(dataUrl),
    };
  }

  const image = await loadImageElement(dataUrl);
  const { canvas, ctx } = surface;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

  const nextDataUrl = canvas.toDataURL(outputType, outputType === "image/jpeg" ? 0.9 : undefined);
  return {
    dataUrl: nextDataUrl,
    format: imageFormatFromDataUrl(nextDataUrl),
  };
}

async function resolveImageAsset(src, fallbackLabel = "Product", rasterize = true) {
  const normalizedSource = String(src || "").trim();

  try {
    const dataUrl = await urlToDataUrl(normalizedSource);
    if (!rasterize) {
      const resolvedFormat = imageFormatFromDataUrl(dataUrl);
      return {
        dataUrl,
        format: resolvedFormat === "PNG" ? "PNG" : "JPEG",
        usedFallback: false,
      };
    }

    const rasterized = await rasterizeImage(dataUrl, 320, 240, "image/jpeg");
    return {
      ...rasterized,
      format: "JPEG",
      usedFallback: false,
    };
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("PDF image fetch failed, using fallback placeholder", {
        source: normalizedSource,
        message: error?.message || String(error),
      });
    }

    const placeholder = createProductPlaceholderAsset(fallbackLabel);
    if (!placeholder) {
      return null;
    }

    return {
      ...placeholder,
      format: "JPEG",
      usedFallback: true,
    };
  }
}

async function resolveBestImageAsset(sources, fallbackLabel = "Product") {
  const candidates = uniqueNonEmpty(sources);

  for (const candidate of candidates) {
    const asset = await resolveImageAsset(candidate, fallbackLabel, true);
    if (asset?.dataUrl && !asset.usedFallback) {
      return {
        imageAsset: asset,
        resolvedSource: candidate,
      };
    }
  }

  const placeholder = await resolveImageAsset("", fallbackLabel, true);
  return {
    imageAsset: placeholder,
    resolvedSource: candidates[0] || "",
  };
}

async function resolveStaticImage(src) {
  try {
    const dataUrl = await urlToDataUrl(src);
    let ratio;

    if (browserCanRasterize()) {
      try {
        const image = await loadImageElement(dataUrl);
        if (image?.naturalWidth > 0 && image?.naturalHeight > 0) {
          ratio = image.naturalWidth / image.naturalHeight;
        }
      } catch (error) {
        ratio = undefined;
      }
    }

    return {
      dataUrl,
      format: imageFormatFromDataUrl(dataUrl),
      ratio,
    };
  } catch (error) {
    return null;
  }
}

async function softenWatermarkAsset(imageAsset) {
  if (!imageAsset?.dataUrl || !browserCanRasterize()) {
    return imageAsset;
  }

  try {
    const image = await loadImageElement(imageAsset.dataUrl);
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = Math.max(1200, image.naturalWidth);
    const height = Math.max(600, Math.round(width / ratio));
    const surface = makeCanvas(width, height);

    if (!surface) {
      return { ...imageAsset, ratio };
    }

    const { canvas, ctx } = surface;
    ctx.clearRect(0, 0, width, height);
    
    // Aggressive softening to match reference PDF: very pale, barely visible.
    ctx.filter = "blur(2px) saturate(10%) brightness(240%) contrast(60%)";
    ctx.drawImage(image, 0, 0, width, height);
    ctx.filter = "none";

    // Tint to very pale tones: white wash + pale yellow overlay.
    // This converts any color (grey, yellow, etc) to near-white pale tones.
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255,255,255,0.75)";  // Heavy white tint
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(245,240,220,0.25)";  // Subtle pale cream
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";

    return {
      dataUrl: canvas.toDataURL("image/png"),
      format: "PNG",
      ratio,
    };
  } catch (error) {
    return imageAsset;
  }
}

async function attachProductImages(products, options = {}) {
  const cache = new Map();
  const validation = [];
  const publicAssetBase = normalizePublicAssetBase(options.publicAssetBase);

  const attached = await Promise.all(
    products.map(async (product) => {
      const normalizedImage = normalizeImageSource(product.image, publicAssetBase);
      const directImage = String(product.image || "").trim();
      const sourceCandidates = uniqueNonEmpty([
        normalizedImage,
        directImage,
        directImage.split("?")[0],
        normalizedImage.split("?")[0],
      ]);
      const key = sourceCandidates[0] || `placeholder:${product.sku}:${product.name}`;

      if (!cache.has(key)) {
        cache.set(key, resolveBestImageAsset(sourceCandidates, product.sku || product.name));
      }

      const resolved = await cache.get(key);
      const imageAsset = resolved?.imageAsset;
      const resolvedSource = resolved?.resolvedSource || normalizedImage;
      const rowValidation = {
        sku: product.sku,
        name: product.name,
        requestedImage: product.image || "",
        resolvedImage: resolvedSource,
        isPublicAbsoluteUrl: /^https?:\/\//i.test(resolvedSource),
        accessible: Boolean(imageAsset?.dataUrl),
        usedFallback: Boolean(imageAsset?.usedFallback),
      };
      validation.push(rowValidation);

      return {
        ...product,
        image: resolvedSource,
        imageAsset,
      };
    })
  );

  return {
    products: attached,
    validation,
  };
}

function summarizeImageValidation(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const failures = list.filter((row) => !row.isPublicAbsoluteUrl || !row.accessible || row.usedFallback);

  return {
    ok: failures.length === 0,
    total: list.length,
    failures,
    rows: list,
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}

async function fetchFontBase64(src) {
  if (isJsdomRuntime() || typeof fetch !== "function" || !src) {
    throw new Error("Font fetch unavailable");
  }

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Font request failed: ${response.status}`);
  }

  return arrayBufferToBase64(await response.arrayBuffer());
}

async function registerPdfFonts(doc) {
  try {
    const [regularBase64, boldBase64] = await Promise.all([
      fetchFontBase64(arialRegularUrl),
      fetchFontBase64(arialBoldUrl),
    ]);

    doc.addFileToVFS("arial.ttf", regularBase64);
    doc.addFont("arial.ttf", CUSTOM_FONT, "normal");
    doc.addFileToVFS("arialbd.ttf", boldBase64);
    doc.addFont("arialbd.ttf", CUSTOM_FONT, "bold");
    return CUSTOM_FONT;
  } catch (error) {
    return "helvetica";
  }
}

function setPdfFont(doc, fontFamily, style = "normal") {
  doc.setFont(fontFamily, style);
}

function addImageSafely(doc, imageAsset, x, y, width, height) {
  if (!imageAsset?.dataUrl) {
    throw new Error("No image data");
  }

  doc.addImage(
    imageAsset.dataUrl,
    imageAsset.format || "PNG",
    x,
    y,
    width,
    height,
    undefined,
    "FAST"
  );
}

function drawImageFallback(doc, x, y, width, height, fontFamily) {
  setDrawColor(doc, COLORS.grid);
  setFillColor(doc, COLORS.headerFill);
  doc.rect(x, y, width, height, "FD");
  setPdfFont(doc, fontFamily, "bold");
  doc.setFontSize(5.8);
  setTextColor(doc, COLORS.muted);
  doc.text("IMG", x + width / 2, y + height / 2 + 1.8, { align: "center" });
}

function fitLines(doc, text, maxWidth, maxLines) {
  const lines = doc.splitTextToSize(String(text || ""), maxWidth);
  return lines.slice(0, maxLines);
}

function buildItemDetailLines(item) {
  const title = item.sku !== "-" && !item.name.toLowerCase().includes(item.sku.toLowerCase())
    ? `${item.sku} - ${item.name}`
    : item.name;

  const lines = [title];
  if (item.details && item.details.toLowerCase() !== item.name.toLowerCase()) {
    lines.push(item.details);
  }
  if (item.size && item.size !== "-") {
    lines.push(`Size : ${item.size}`);
  }
  if (item.mrp > 0) {
    lines.push(`MRP : ${formatWholeCurrency(item.mrp)}`);
  }
  if (item.color && item.color !== "-") {
    lines.push(item.color);
  }

  return lines.filter(Boolean);
}

function drawReferenceHeader(doc, payload, assets, fontFamily) {
  const clientInfo = getClientInfo(payload);
  const proposalNo = String(payload.proposalNo || payload.proposalNumber || clientInfo.proposalNo || "-");
  const preparedBy = String(payload.preparedBy || clientInfo.preparedBy || "-");
  const preparedPhone = String(payload.preparedPhone || clientInfo.preparedPhone || clientInfo.preparedMobile || "");
  const preparedText = preparedPhone ? `${preparedBy} - ${preparedPhone}` : preparedBy;
  const proposalDate = formatDisplayDate(payload.date || payload.proposalDate || new Date());
  const partnerLogoCenterY = 20.105;

  try {
    addImageSafely(doc, assets.aquantLogo, 17.16, partnerLogoCenterY - 7.41 / 2, 16.93, 7.41);
    addImageSafely(doc, assets.kohlerLogo, 36.56, partnerLogoCenterY - 5.15 / 2, 16.93, 5.15);
    addImageSafely(doc, assets.plumberLogo, 55.96, partnerLogoCenterY - 4.81 / 2, 16.93, 4.81);
  } catch (error) {
    // The source PDF uses partner logos here. If an asset cannot load, the reserved
    // space stays blank to keep header geometry identical.
  }

  setDrawColor(doc, [211, 211, 211]);
  doc.setLineWidth(0.18);
  doc.line(76.78, 9.17, 76.78, 31.04);

  setTextColor(doc, COLORS.ink);
  setPdfFont(doc, fontFamily, "bold");
  doc.setFontSize(22);
  doc.text("Shreeji Ceramica", 135.25, 18.1, { align: "center" });

  setTextColor(doc, COLORS.gold);
  setPdfFont(doc, fontFamily, "bold");
  doc.setFontSize(10);
  doc.text("Redefining Luxury", 151.2, 23.35, { align: "center", angle: 0 });

  setTextColor(doc, COLORS.muted);
  setPdfFont(doc, fontFamily, "normal");
  doc.setFontSize(8.5);
  doc.text("Ph: +91 9033745455 | shreejiceramica303@gmail.com", 130.2, 29.0, {
    align: "center",
  });

  try {
    addImageSafely(doc, assets.shreejiLogo, 166.74, 12.17, 26.46, 15.87);
  } catch (error) {
    setTextColor(doc, COLORS.ink);
    setPdfFont(doc, fontFamily, "bold");
    doc.setFontSize(10);
    doc.text("Shreeji Ceramica", 193.2, 19.0, { align: "right" });
  }

  setDrawColor(doc, COLORS.red);
  doc.setLineWidth(0.5);
  doc.line(12.7, 33.34, 197.3, 33.34);

  setTextColor(doc, COLORS.gold);
  setPdfFont(doc, fontFamily, "bold");
  doc.setFontSize(20);
  doc.text("BUSINESS PROPOSAL", 14.16, 44.45);

  setTextColor(doc, COLORS.black);
  doc.setFontSize(8.5);
  doc.text(`No: ${proposalNo}`, 195.84, 41.0, { align: "right" });
  doc.text(`Date: ${proposalDate}`, 195.84, 44.9, { align: "right" });
  doc.text(`Prepared By: ${preparedText}`, 195.84, 48.8, { align: "right" });

  setTextColor(doc, COLORS.ink);
  setPdfFont(doc, fontFamily, "bold");
  doc.setFontSize(10);

  const labelX = 19.45;
  const valueX = 50.4;
  const rows = [
    ["Client Name:", clientInfo.clientName || clientInfo.name || ""],
    ["Mobile No:", clientInfo.mobile || clientInfo.phone || clientInfo.mobileNo || ""],
    ["Company:", clientInfo.company || clientInfo.companyName || ""],
    ["Address:", clientInfo.address || clientInfo.siteAddress || ""],
  ];

  rows.forEach(([label, value], index) => {
    const y = 58.5 + index * 6.7;
    doc.text(label, labelX, y);
    if (value) {
      setPdfFont(doc, fontFamily, "normal");
      doc.text(fitLines(doc, value, 138, 2), valueX, y);
      setPdfFont(doc, fontFamily, "bold");
    }
  });

  return 89.5;
}

function drawWatermark(doc, imageAsset) {
  if (!imageAsset?.dataUrl) {
    return;
  }

  let drawWidth = WATERMARK.width;
  let drawHeight = WATERMARK.height;
  const ratio = coerceNumber(imageAsset.ratio);

  if (ratio > 0) {
    drawHeight = drawWidth / ratio;
    if (drawHeight > WATERMARK.height) {
      drawHeight = WATERMARK.height;
      drawWidth = drawHeight * ratio;
    }
  }

  const x = (PAGE.width - drawWidth) / 2;
  const y = (PAGE.height - drawHeight) / 2;

  try {
    if (typeof doc.setGState === "function" && typeof doc.GState === "function") {
      doc.setGState(new doc.GState({ opacity: WATERMARK.opacity }));
    }

    addImageSafely(doc, imageAsset, x, y, drawWidth, drawHeight);

    if (typeof doc.setGState === "function" && typeof doc.GState === "function") {
      doc.setGState(new doc.GState({ opacity: 1 }));
    }
  } catch (error) {
    // Watermark is decorative; keep PDF generation resilient.
  }
}

function ensurePageSpace(doc, y, neededHeight = 24) {
  if (y > 260 || y + neededHeight > PAGE.bottom) {
    doc.addPage();
    return 20;
  }

  return y;
}

function drawRoomHeading(doc, room, y, fontFamily) {
  setPdfFont(doc, fontFamily, "bold");
  doc.setFontSize(11.5);
  setTextColor(doc, COLORS.navy);
  doc.text(String(room).toUpperCase(), 12.7, y + 4.75);
}

function drawItemDetailsCell(doc, data, fontFamily) {
  const raw = data.cell.raw;
  if (!raw?.lines) {
    return;
  }

  const x = data.cell.x + 2.3;
  let y = data.cell.y + 6.15;
  const maxWidth = data.cell.width - 4.6;
  const lineHeight = 3.65;
  const maxLines = Math.max(1, Math.floor((data.cell.height - 4.1) / lineHeight));
  const lines = raw.lines
    .flatMap((line) => doc.splitTextToSize(line, maxWidth))
    .slice(0, maxLines);

  lines.forEach((line, index) => {
    setPdfFont(doc, fontFamily, index === 0 ? "bold" : "normal");
    doc.setFontSize(8);
    setTextColor(doc, COLORS.ink);
    doc.text(line, x, y);
    y += lineHeight;
  });
}

function drawRoomTable(doc, room, items, startY, fontFamily) {
  drawRoomHeading(doc, room, startY, fontFamily);

  const body = items.map((item, index) => [
    String(index + 1),
    { imageAsset: item.imageAsset },
    { lines: buildItemDetailLines(item) },
    item.sku,
    item.size,
    String(item.qty),
    formatCurrency(item.rate),
    formatPercent(item.discount),
    formatCurrency(item.amount),
  ]);

  const roomTotal = items.reduce((sum, item) => sum + coerceNumber(item.amount), 0);
  body.push([
    {
      content: "TOTAL",
      colSpan: 8,
      styles: {
        halign: "center",
        fontStyle: "bold",
        fontSize: 7.6,
        minCellHeight: TABLE.totalHeight,
      },
    },
    {
      content: formatCurrency(roomTotal),
      styles: {
        halign: "right",
        fontStyle: "bold",
        fontSize: 7.6,
        minCellHeight: TABLE.totalHeight,
      },
    },
  ]);

  autoTable(doc, {
    startY: startY + 6.63,
    head: [["#", "IMG", "Item Details", "SKU", "Size", "Qty", "Rate", "Disc %", "Amount"]],
    body,
    theme: "grid",
    margin: { left: TABLE.left, right: PAGE.width - TABLE.right },
    tableWidth: TABLE.width,
    pageBreak: "auto",
    rowPageBreak: "avoid",
    styles: {
      font: fontFamily,
      fontSize: 7.6,
      cellPadding: { top: 2.2, right: 1.8, bottom: 2.2, left: 1.8 },
      lineColor: COLORS.grid,
      lineWidth: TABLE.lineWidth,
      textColor: COLORS.ink,
      valign: "middle",
      overflow: "linebreak",
      minCellHeight: TABLE.bodyMinHeight,
    },
    headStyles: {
      fillColor: COLORS.headerFill,
      textColor: COLORS.ink,
      fontStyle: "bold",
      fontSize: 8,
      halign: "center",
      minCellHeight: TABLE.headerHeight,
    },
    columnStyles: {
      0: { cellWidth: TABLE.columns[0], halign: "center" },
      1: { cellWidth: TABLE.columns[1], halign: "center" },
      2: { cellWidth: TABLE.columns[2], halign: "left" },
      3: { cellWidth: TABLE.columns[3], halign: "center" },
      4: { cellWidth: TABLE.columns[4], halign: "center" },
      5: { cellWidth: TABLE.columns[5], halign: "center" },
      6: { cellWidth: TABLE.columns[6], halign: "right" },
      7: { cellWidth: TABLE.columns[7], halign: "center" },
      8: {
        cellWidth: TABLE.columns[8],
        halign: "right",
        fontStyle: "bold",
        cellPadding: { top: 2.2, right: 2.3, bottom: 2.2, left: 1.8 },
      },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 1) {
        data.cell.text = [""];
      }

      if (data.section === "body" && data.column.index === 2 && data.cell.raw?.lines) {
        const allLines = data.cell.raw.lines.flatMap((line) => doc.splitTextToSize(line, 55.35));
        data.cell.text = allLines;
        data.cell.styles.textColor = COLORS.white;
      }
    },
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 1) {
        const imageAsset = data.cell.raw?.imageAsset;
        const width = Math.min(14.82, data.cell.width - 2.2);
        const height = Math.min(14.82, data.cell.height - 4.0);
        const x = data.cell.x + (data.cell.width - width) / 2;
        const y = data.cell.y + (data.cell.height - height) / 2;

        try {
          addImageSafely(doc, imageAsset, x, y, width, height);
        } catch (error) {
          drawImageFallback(doc, x, y, width, height, fontFamily);
        }
      }

      if (data.section === "body" && data.column.index === 2 && data.cell.raw?.lines) {
        drawItemDetailsCell(doc, data, fontFamily);
      }
    },
  });

  return {
    y: doc.lastAutoTable ? doc.lastAutoTable.finalY : startY + 30,
    total: roomTotal,
  };
}

function drawRoomTables(doc, grouped, startY, fontFamily) {
  const roomTotals = new Map();
  const entries = Array.from(grouped.entries());
  let y = startY;

  entries.forEach(([room, items], index) => {
    const estimatedRoomHeight = TABLE.headerHeight + TABLE.totalHeight + 10 + items.length * TABLE.bodyMinHeight;
    y = ensurePageSpace(doc, y, estimatedRoomHeight);
    const result = drawRoomTable(doc, room, items, y, fontFamily);
    roomTotals.set(room, result.total);
    y = index === entries.length - 1 ? result.y : result.y + 3.95;
  });

  return { y, roomTotals };
}

function drawTotalsBox(doc, y, totals, fontFamily) {
  const x = 105.58;
  const splitX = 154.97;
  const width = 91.72;
  const rowH = 8.47;
  const height = rowH * 3;

  setDrawColor(doc, COLORS.grid);
  doc.setLineWidth(0.22);
  doc.rect(x, y, width, height);
  doc.setLineWidth(0.14);
  doc.line(splitX, y, splitX, y + height);
  doc.line(x, y + rowH, x + width, y + rowH);
  doc.line(x, y + rowH * 2, x + width, y + rowH * 2);

  const rows = [
    ["Subtotal", formatCurrency(totals.subtotal)],
    [`GST (${formatPercent(totals.gstRate)})`, formatCurrency(totals.gst)],
    ["Final Amount", formatCurrency(totals.grand)],
  ];

  rows.forEach(([label, amount], index) => {
    const baseline = y + 5.75 + index * rowH;
    setPdfFont(doc, fontFamily, "bold");
    doc.setFontSize(10);
    setTextColor(doc, index === 2 ? COLORS.navy : COLORS.black);
    doc.text(label, splitX - 2.4, baseline, { align: "right" });
    doc.text(amount, x + width - 2.3, baseline, { align: "right" });
  });

  return y + height + 3.8;
}

function drawSummaryTable(doc, y, roomTotals, totals, fontFamily) {
  const x = 10.63;
  const width = 188.74;
  const splitX = 155.27;
  const headerH = 9.88;
  const rowH = 9.88;
  const rows = [
    ...Array.from(roomTotals.entries()).map(([room, total]) => [String(room).toUpperCase(), formatCurrency(total)]),
    [`GST (${formatPercent(totals.gstRate)})`, formatCurrency(totals.gst)],
  ];

  setFillColor(doc, COLORS.navy);
  doc.rect(x, y, width, headerH, "F");
  setDrawColor(doc, COLORS.grid);
  doc.setLineWidth(0.32);
  doc.rect(x, y, width, headerH + rows.length * rowH);
  doc.setLineWidth(0.14);
  doc.line(splitX, y + headerH, splitX, y + headerH + rows.length * rowH);

  setPdfFont(doc, fontFamily, "bold");
  doc.setFontSize(11);
  setTextColor(doc, COLORS.white);
  doc.text("SUMMARY OF ALL BATH ROOM", x + width / 2, y + 6.85, { align: "center" });

  rows.forEach(([label, amount], index) => {
    const top = y + headerH + index * rowH;
    doc.line(x, top, x + width, top);
    setTextColor(doc, COLORS.navy);
    setPdfFont(doc, fontFamily, "normal");
    doc.setFontSize(10.5);
    doc.text(label, x + 72.8, top + 6.6, { align: "center" });
    setPdfFont(doc, fontFamily, "bold");
    doc.text(amount, x + width - 3.15, top + 6.6, { align: "right" });
  });

  return y + headerH + rows.length * rowH + 4;
}

function drawSummaryAndTotals(doc, y, roomTotals, gstRate, fontFamily) {
  const subtotal = Array.from(roomTotals.values()).reduce((sum, total) => sum + coerceNumber(total), 0);
  const gst = subtotal * (gstRate / 100);
  const grand = subtotal + gst;
  const totals = { subtotal, gst, grand, gstRate };

  // Keep summary + subtotal/gst/final-amount together as one non-breaking block.
  const summaryRows = roomTotals.size + 1;
  const summaryHeaderH = 9.88;
  const summaryRowH = 9.88;
  const summaryHeight = summaryHeaderH + summaryRows * summaryRowH + 4;
  const totalsHeight = 8.47 * 3 + 3.8;
  const summaryBlockHeight = 4.23 + totalsHeight + summaryHeight;
  y = ensurePageSpace(doc, y, summaryBlockHeight);

  y = drawTotalsBox(doc, y + 4.23, totals, fontFamily);
  y = drawSummaryTable(doc, y, roomTotals, totals, fontFamily);

  return { y, ...totals };
}

function drawTermsAndSignatoryPage(doc, fontFamily) {
  doc.addPage();

  setTextColor(doc, COLORS.ink);
  doc.setFontSize(10);
  doc.text("Terms & Conditions:", 14.16, 22.0);

  setPdfFont(doc, fontFamily, "normal");
  doc.setFontSize(8);
  const terms = [
    "1. Quotation is valid for 15 days from the issued date.",
    "2. 100% advance payment required along with the purchase order.",
    "3. Goods once sold will not be taken back or exchanged.",
    "4. Subject to local jurisdiction only.",
  ];

  terms.forEach((term, index) => {
    doc.text(term, 14.16, 28.9 + index * 4.23);
  });

  setPdfFont(doc, fontFamily, "bold");
  doc.setFontSize(10);
  setTextColor(doc, COLORS.black);
  doc.text("For Shreeji Ceramica", 193.7, 28.0, { align: "right" });
  doc.setFontSize(9);
  doc.text("Authorized Signatory", 193.7, 47.95, { align: "right" });
}

function addWatermarks(doc, watermarkAsset) {
  const pageCount = doc.internal.getNumberOfPages();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    drawWatermark(doc, watermarkAsset);
  }
}

function addFooters(doc, fontFamily) {
  const pageCount = doc.internal.getNumberOfPages();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    setPdfFont(doc, fontFamily, "normal");
    doc.setFontSize(7);
    setTextColor(doc, COLORS.muted);
    doc.text(`Shreeji Ceramica Page ${pageNumber} of ${pageCount}`, PAGE.width / 2, PAGE.footerY, {
      align: "center",
    });
  }
}

function openPreviewBlob(blob, previewTarget) {
  if (typeof window === "undefined" || !window.URL) {
    return "";
  }

  const url = window.URL.createObjectURL(blob);

  if (typeof previewTarget === "function") {
    previewTarget(url);
    return url;
  }

  const previewWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (!previewWindow && typeof document !== "undefined") {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  }

  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  return url;
}

async function loadReferenceAssets(options) {
  const branding = options.branding !== false;
  const [shreejiLogo, aquantLogo, kohlerLogo, plumberLogo, rawWatermark] = await Promise.all([
    branding ? resolveStaticImage(options.logo || options.logoUrl || shreejiLogoUrl) : Promise.resolve(null),
    branding ? resolveStaticImage(aquantLogoUrl) : Promise.resolve(null),
    branding ? resolveStaticImage(kohlerLogoUrl) : Promise.resolve(null),
    branding ? resolveStaticImage(plumberLogoUrl) : Promise.resolve(null),
    branding ? resolveStaticImage(shreejiWatermarkUrl) : Promise.resolve(null),
  ]);

  const watermark = branding ? await softenWatermarkAsset(rawWatermark) : null;

  return { shreejiLogo, aquantLogo, kohlerLogo, plumberLogo, watermark };
}

export async function generateQuotationPDF(data, options = {}) {
  const input = Array.isArray(data) ? { products: data } : data || {};
  const clientInfo = getClientInfo(input);
  const rawProducts = Array.isArray(input.products)
    ? input.products
    : Array.isArray(input.bom)
      ? input.bom
      : Array.isArray(input.items)
        ? input.items
        : [];

  const mergedOptions = {
    preview: Boolean(options.preview),
    download: Boolean(options.download),
    branding: options.branding ?? input.branding ?? true,
    previewTarget: options.previewTarget,
    gstRate: Math.max(0, coerceNumber(options.gstRate ?? input.gstRate ?? GST_RATE) || GST_RATE),
    logo: options.logo || input.logo || input.logoDataUrl,
    logoUrl: options.logoUrl || input.logoUrl,
    publicAssetBase: options.publicAssetBase || input.publicAssetBase || DEFAULT_PUBLIC_ASSET_BASE,
    onImageValidation: typeof options.onImageValidation === "function" ? options.onImageValidation : undefined,
  };

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const fontFamily = await registerPdfFonts(doc);

  doc.setProperties({
    title: "Shreeji Ceramica Business Proposal",
    subject: "Business Proposal",
    author: "Shreeji Ceramica",
    creator: "Shreeji Ceramica Quotation System",
  });

  const assets = await loadReferenceAssets(mergedOptions);
  const imageResult = await attachProductImages(rawProducts.map(normalizeProduct), {
    publicAssetBase: mergedOptions.publicAssetBase,
  });
  const products = imageResult.products;
  const imageValidation = summarizeImageValidation(imageResult.validation);

  if (mergedOptions.onImageValidation) {
    mergedOptions.onImageValidation(imageValidation);
  }

  if (!imageValidation.ok && typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("Some SKU images could not be embedded in PDF.", imageValidation.failures);
  }
  const grouped = groupByRoom(products);

  let y = drawReferenceHeader(doc, input, assets, fontFamily);
  const roomResult = drawRoomTables(doc, grouped, y, fontFamily);
  drawSummaryAndTotals(doc, roomResult.y, roomResult.roomTotals, mergedOptions.gstRate, fontFamily);
  drawTermsAndSignatoryPage(doc, fontFamily);
  addWatermarks(doc, assets.watermark);
  addFooters(doc, fontFamily);

  const blob = doc.output("blob");
  const filename =
    options.filename ||
    input.filename ||
    buildFileName(input.date || new Date(), clientInfo.clientName || clientInfo.name || "");

  if (mergedOptions.preview) {
    openPreviewBlob(blob, mergedOptions.previewTarget);
  }

  if (mergedOptions.download) {
    doc.save(filename);
  }

  return blob;
}

export { buildFileName as buildProposalFileName, formatCurrency };
