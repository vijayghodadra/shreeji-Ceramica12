import React, { useMemo, useState, useEffect } from "react";
import axios from "axios";
import "./App.css";
import { buildProposalFileName, generateQuotationPDF } from "./pdf/quotationPdf";

const defaultBackendUrl =
  process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:8001"
    : "https://shriji-tiles.onrender.com";

const runtimeBackendUrl =
  (typeof window !== "undefined" && window.desktopConfig?.backendUrl) ||
  process.env.REACT_APP_BACKEND_URL ||
  defaultBackendUrl;

const BACKEND_BASE_URL = runtimeBackendUrl.replace(/\/+$/, "");
const PUBLIC_ASSET_BASE_URL =
  process.env.REACT_APP_PUBLIC_ASSET_BASE_URL ||
  BACKEND_BASE_URL;
const PUBLIC_FALLBACK_IMAGE_PATH = "/assets/fallback-product.svg";
const API_URL = `${BACKEND_BASE_URL}/search`;

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const catalogOptions = [
  { id: "all", label: "All" },
  { id: "aquant", label: "Aquant" },
  { id: "kohler", label: "Kohler" },
];

const variantOrder = ["BRG", "BG", "GG", "MB", "CP", "RG", "AB", "G"];

const roomOptions = [
  "Kid's Bathroom",
  "Guest Bathroom",
  "Parent's Bathroom",
  "Master Bathroom",
  "Common / Powder Room",
  "Living Room",
  "Kitchen",
  "Balcony",
  "Utility Room",
];

function buildPlaceholder(productName = "Catalog product") {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420">
      <rect width="640" height="420" rx="18" fill="#ededed" />
      <rect x="40" y="40" width="560" height="340" rx="14" fill="#f6f6f6" stroke="#d5d5d5" stroke-width="4" />
      <text x="320" y="194" text-anchor="middle" font-size="44" font-weight="700" font-family="Arial, sans-serif" fill="#5d5d5d">
        IMAGE NOT FOUND
      </text>
      <text x="320" y="236" text-anchor="middle" font-size="18" font-family="Arial, sans-serif" fill="#7a7a7a">
        ${productName.replace(/[<&>]/g, "").slice(0, 44)}
      </text>
    </svg>
  `)}`;
}

function parseCodeParts(value) {
  const text = String(value || "").trim().toUpperCase();
  const baseMatch = text.match(/(\d{3,5})/);
  if (!baseMatch) {
    return { baseCode: "", variant: "" };
  }

  const baseCode = baseMatch[1];
  const tail = text.slice(baseMatch.index + baseCode.length).replace(/[^A-Z0-9]+/g, "").trim();
  return { baseCode, variant: tail.slice(0, 6) };
}

function coercePrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }

  const match = text.replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  if (!match) {
    return 0;
  }

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.round(parsed);
}

function isLocalHost(hostname) {
  return /^(localhost|127\.0\.0\.1|::1)$/i.test(String(hostname || "").trim());
}

function toAbsolutePublicUrl(value, baseUrl = PUBLIC_ASSET_BASE_URL) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("data:image") || raw.startsWith("blob:")) {
    return raw;
  }

  try {
    const base = new URL(String(baseUrl || PUBLIC_ASSET_BASE_URL).trim() || PUBLIC_ASSET_BASE_URL);
    const parsed = new URL(raw, base);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    if (isLocalHost(parsed.hostname) && !isLocalHost(base.hostname)) {
      return `${base.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return parsed.toString();
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

function getPublicFallbackImageUrl() {
  const runtimeBase =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : PUBLIC_ASSET_BASE_URL;

  return toAbsolutePublicUrl(PUBLIC_FALLBACK_IMAGE_PATH, runtimeBase);
}

function normalizeImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const candidates = uniqueNonEmpty([
    toAbsolutePublicUrl(raw, BACKEND_BASE_URL),
    toAbsolutePublicUrl(raw, PUBLIC_ASSET_BASE_URL),
  ]);

  return candidates[0] || "";
}

function buildProductImageUrl(product) {
  const primary = normalizeImageUrl(product?.image);
  if (primary) {
    return primary;
  }

  return getPublicFallbackImageUrl() || buildPlaceholder(product?.name);
}

function handleProductImageError(event, product) {
  const target = event.currentTarget;
  target.dataset.fallbackCount = "1";
  target.src = getPublicFallbackImageUrl() || buildPlaceholder(product?.name);
}

async function isDirectImageUrlAccessible(url) {
  const target = String(url || "").trim();
  if (!target || target.startsWith("data:image") || target.startsWith("blob:")) {
    return Boolean(target);
  }

  try {
    const response = await fetch(target);

    if (!response.ok) {
      console.warn("Image URL fetch failed", { url: target, status: response.status });
      return false;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const isImage = contentType.includes("image/");
    if (!isImage) {
      console.warn("Image URL returned non-image content", { url: target, contentType });
    }
    return isImage;
  } catch (error) {
    console.warn("Image URL fetch threw error", {
      url: target,
      message: error?.message || String(error),
    });
    return false;
  }
}

async function resolvePdfImageUrl(item) {
  const normalized = normalizeImageUrl(item?.image);
  const raw = String(item?.image || "").trim();
  const candidates = uniqueNonEmpty([
    normalized,
    toAbsolutePublicUrl(raw, PUBLIC_ASSET_BASE_URL),
    toAbsolutePublicUrl(raw, BACKEND_BASE_URL),
    toAbsolutePublicUrl(raw.split("?")[0], PUBLIC_ASSET_BASE_URL),
  ]);

  for (const candidate of candidates) {
    if (await isDirectImageUrlAccessible(candidate)) {
      return candidate;
    }
  }

  const fallbackUrl = getPublicFallbackImageUrl();
  if (await isDirectImageUrlAccessible(fallbackUrl)) {
    return fallbackUrl;
  }

  return buildPlaceholder(item?.name);
}

function normalizeSnippet(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildDisplayName(product) {
  const words = normalizeSnippet(product.name)
    .split(" ")
    .filter(Boolean)
    .filter((word, index, array) => {
      if (index === 0) {
        return true;
      }
      return word.toLowerCase() !== array[index - 1].toLowerCase();
    });

  if (words.length <= 2) {
    return words.join(" ");
  }

  return words.slice(0, 2).join(" ");
}


function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [activeCatalog, setActiveCatalog] = useState("all");
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [pdfZoom, setPdfZoom] = useState(100);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [imagePreview, setImagePreview] = useState({
    isOpen: false,
    src: "",
    title: "",
    zoom: 1,
  });

  // Client State
  const [clientInfo, setClientInfo] = useState({
    preparedBy: "Jagdish",
    proposalNo: `PRO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    clientName: "",
    phone: "",
    company: "",
    email: "",
    address: "",
    gstCompliance: false,
    gstPercentage: 18
  });

  // Discount State
  const [discountConfig, setDiscountConfig] = useState({
    method: "item-wise", // "item-wise", "common", "total"
    bulkDiscount: 0,
    flatDiscount: 0,
    watermark: true
  });

  // BOM State
  const [bom, setBom] = useState([]);

  useEffect(() => {
    setQuery("");
    setResults([]);
    setSuggestions([]);
    setHasSearched(false);
    setShowSuggestions(false);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        window.URL.revokeObjectURL(pdfPreviewUrl);
      }
    };
  }, [pdfPreviewUrl]);

  const searchRef = React.useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setHasSearched(false);
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounce effect for search (increased to 400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 1) {
        // Fetch autocomplete suggestions
        fetchSuggestions(query.trim(), activeCatalog);
        // Execute full search
        executeSearch(query.trim(), activeCatalog);
      } else {
        setResults([]);
        setSuggestions([]);
        setHasSearched(false);
        setShowSuggestions(false);
      }
    }, 400);  // Increased debounce from 200ms to 400ms
    return () => clearTimeout(timer);
  }, [query, activeCatalog]);

  async function fetchSuggestions(searchQuery, catalogId) {
    if (!searchQuery || searchQuery.length < 1) {
      setSuggestions([]);
      return;
    }
    try {
      const autocompleteUrl = `${BACKEND_BASE_URL}/autocomplete?q=${encodeURIComponent(searchQuery)}&catalog=${encodeURIComponent(catalogId)}&limit=8`;
      const response = await axios.get(autocompleteUrl);
      setSuggestions(response.data?.suggestions || []);
      setShowSuggestions(true);
    } catch (error) {
      setSuggestions([]);
    }
  }

  async function executeSearch(searchQuery, catalogId) {
    if (!searchQuery) return;
    setLoading(true);
    try {
      const requestUrl = `${API_URL}?q=${encodeURIComponent(searchQuery)}&catalog=${encodeURIComponent(catalogId)}`;
      const response = await axios.get(requestUrl);
      setResults(response.data?.results || []);
      setHasSearched(true);
    } catch (requestError) {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  const selectSuggestion = (suggestion) => {
    setQuery(suggestion.code);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  async function runSearch(event) {
    event.preventDefault();
    if (query.trim()) {
      setShowSuggestions(false);
      await executeSearch(query.trim(), activeCatalog);
    }
  }

  const groupedResults = useMemo(() => {
    const groups = new Map();

    for (const product of results) {
      const parsed = parseCodeParts(product?.code);
      const baseCode = product?.baseCode || parsed.baseCode || String(product?.code || "").trim();
      const variant = String(product?.variant || parsed.variant || "").toUpperCase();
      const isCp = Boolean(product?.isCp || variant === "CP");
      const normalizedPrice = coercePrice(product?.price);

      if (!groups.has(baseCode)) {
        groups.set(baseCode, []);
      }

      groups.get(baseCode).push({
        ...product,
        price: normalizedPrice,
        baseCode,
        variant,
        isCp,
      });
    }

    return [...groups.entries()].map(([baseCode, items]) => {
      items.sort((left, right) => {
        const leftIndex = variantOrder.indexOf(left.variant);
        const rightIndex = variantOrder.indexOf(right.variant);
        const leftRank = leftIndex === -1 ? 99 : leftIndex;
        const rightRank = rightIndex === -1 ? 99 : rightIndex;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return String(left.code || "").localeCompare(String(right.code || ""));
      });
      return { baseCode, items };
    });
  }, [results]);

  const addToBom = (product) => {
    const newItem = {
      id: `${product.source}-${product.code}-${Date.now()}`,
      code: product.code,
      name: product.name,
      displayName: buildDisplayName(product),
      source: product.sourceLabel,
      image: product.image,
      size: product.size || "-",
      color: product.color || "-",
      qty: 1,
      rate: coercePrice(product.price),
      discount: 0, // row-specific discount %
      room: "",
    };
    setBom((prev) => [...prev, newItem]);
    setResults([]);
    setQuery("");
    setHasSearched(false);
  };

  const updateBomItem = (id, field, value) => {
    setBom((prev) => prev.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  const removeBomItem = (id) => {
    setBom((prev) => prev.filter((item) => item.id !== id));
  };

  // --- CALCULATION LOGIC ---
  const calculateRowAmount = (item) => {
    const baseTotal = item.qty * item.rate;
    let discPercent = 0;
    
    if (discountConfig.method === "item-wise") {
      discPercent = item.discount;
    } else if (discountConfig.method === "common") {
      discPercent = discountConfig.bulkDiscount;
    }

    return baseTotal * (1 - discPercent / 100);
  };

  const subtotal = bom.reduce((acc, item) => acc + (item.qty * item.rate), 0);
  const totalAfterItemDisc = bom.reduce((acc, item) => acc + calculateRowAmount(item), 0);
  
  let finalBeforeGst = totalAfterItemDisc;
  if (discountConfig.method === "on-total") {
    finalBeforeGst = Math.max(0, subtotal - discountConfig.flatDiscount);
  }

  const totalGst = clientInfo.gstCompliance ? (finalBeforeGst * (clientInfo.gstPercentage / 100)) : 0;
  const grandTotal = finalBeforeGst + totalGst;

  const closePdfPreview = () => {
    if (pdfPreviewUrl) {
      window.URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl("");
      setPdfZoom(100);
    }
  };

  const openImagePreview = (event, product) => {
    if (event) {
      event.stopPropagation();
    }

    setImagePreview({
      isOpen: true,
      src: buildProductImageUrl(product),
      title: `${product?.code || ""} ${product?.name || ""}`.trim() || "Product image",
      zoom: 1,
    });
  };

  const closeImagePreview = () => {
    setImagePreview({
      isOpen: false,
      src: "",
      title: "",
      zoom: 1,
    });
  };

  const downloadPreviewPdf = () => {
    if (!pdfPreviewUrl) return;
    const link = document.createElement('a');
    link.href = pdfPreviewUrl;
    link.setAttribute('download', buildProposalFileName(new Date(), clientInfo.clientName));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const buildPdfData = async () => {
    const products = await Promise.all(
      bom.map(async (item) => ({
        name: item.name,
        sku: item.code,
        size: item.size,
        qty: item.qty,
        rate: item.rate,
        discount: discountConfig.method === "common" ? discountConfig.bulkDiscount : item.discount,
        amount: calculateRowAmount(item),
        image: await resolvePdfImageUrl(item),
        room: Array.isArray(item.room) ? item.room : item.room ? [item.room] : [],
        details: item.displayName ? `${item.displayName}` : item.name,
        color: item.color,
        source: item.source,
        mrp: item.rate,
      }))
    );

    return {
      clientInfo: {
        ...clientInfo,
        mobile: clientInfo.phone,
        name: clientInfo.clientName,
      },
      proposalNo: clientInfo.proposalNo,
      date: new Date().toISOString(),
      products,
      gstRate: clientInfo.gstPercentage,
      publicAssetBase: PUBLIC_ASSET_BASE_URL,
    };
  };

  const generatePdf = async (preview = false) => {
    if (bom.length === 0) return alert("Add items first");
    setPdfGenerating(true);
    try {
      const payload = await buildPdfData();
      const pdfBlob = await generateQuotationPDF(payload, {
        branding: discountConfig.watermark,
        download: !preview,
        preview,
        publicAssetBase: PUBLIC_ASSET_BASE_URL,
        onImageValidation: (report) => {
          if (!report?.ok) {
            console.warn("PDF SKU-image validation report:", report);
          }
        },
        previewTarget: preview
          ? (url) => {
              if (pdfPreviewUrl) {
                window.URL.revokeObjectURL(pdfPreviewUrl);
              }
              setPdfPreviewUrl(url);
            }
          : undefined,
        filename: buildProposalFileName(payload.date, clientInfo.clientName),
      });

      if (preview) {
        setPdfZoom(100);
        return pdfBlob;
      }
    } catch (err) {
      console.error("PDF Error:", err);
      alert("Failed to generate PDF");
    } finally {
      setPdfGenerating(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="workspace-panel shadow-glass">
        {/* 1. CLIENT INFORMATION FORM (TOP) */}
        <div className="client-form-section card-box">
          <h2 className="section-title">👤 Client Information</h2>
          <div className="form-grid">
            <div className="field-group">
              <label>Prepared By</label>
              <select 
                value={clientInfo.preparedBy} 
                onChange={(e) => setClientInfo({...clientInfo, preparedBy: e.target.value})}
              >
                <option>Jagdish</option>
                <option>Tejesh</option>
                <option>Admin</option>
              </select>
            </div>
            <div className="field-group">
              <label>Proposal No</label>
              <input type="text" value={clientInfo.proposalNo} onChange={(e) => setClientInfo({...clientInfo, proposalNo: e.target.value})} />
            </div>
            <div className="field-group">
              <label>Client Name / Business</label>
              <input type="text" placeholder="Enter name" value={clientInfo.clientName} onChange={(e) => setClientInfo({...clientInfo, clientName: e.target.value})} />
            </div>
            <div className="field-group">
              <label>Phone Number</label>
              <input type="text" placeholder="+91 ..." value={clientInfo.phone} onChange={(e) => setClientInfo({...clientInfo, phone: e.target.value})} />
            </div>
            <div className="field-group">
              <label>Company</label>
              <input type="text" placeholder="Company name" value={clientInfo.company} onChange={(e) => setClientInfo({...clientInfo, company: e.target.value})} />
            </div>
            <div className="field-group">
              <label>Email Address</label>
              <input type="email" placeholder="example@mail.com" value={clientInfo.email} onChange={(e) => setClientInfo({...clientInfo, email: e.target.value})} />
            </div>
            <div className="field-group full-width">
              <label>Project Site / Address</label>
              <textarea placeholder="Enter address details..." value={clientInfo.address} onChange={(e) => setClientInfo({...clientInfo, address: e.target.value})} />
            </div>
            <div className="field-group inline-group">
              <label className="checkbox-label">
                <input type="checkbox" checked={clientInfo.gstCompliance} onChange={(e) => setClientInfo({...clientInfo, gstCompliance: e.target.checked})} />
                Apply GST Compliance
              </label>
            </div>
            {clientInfo.gstCompliance && (
              <div className="field-group">
                <label>GST %</label>
                <input type="number" value={clientInfo.gstPercentage} onChange={(e) => setClientInfo({...clientInfo, gstPercentage: parseFloat(e.target.value) || 0})} />
              </div>
            )}
          </div>
        </div>

        <div className="catalog-switcher">
          {catalogOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={activeCatalog === option.id ? "catalog-chip is-active" : "catalog-chip"}
              onClick={() => setActiveCatalog(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="search-section-wrapper" ref={searchRef}>
          <form className="search-form" onSubmit={runSearch}>
            <div className="search-input-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Type code (e.g. 2631) or name..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
                          {/* Autocomplete Suggestions Dropdown */}
                          {showSuggestions && suggestions.length > 0 && (
                            <div className="suggestions-dropdown">
                              {suggestions.map((suggestion, index) => (
                                <button
                                  key={`${suggestion.code || suggestion.name || "suggestion"}-${index}`}
                                  type="button"
                                  className="suggestion-item"
                                  onClick={() => selectSuggestion(suggestion)}
                                >
                                  <span className="suggestion-code">{suggestion.code}</span>
                                  <span className="suggestion-name">{suggestion.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
            </div>
            <button type="submit" disabled={loading} className="btn-accent">
              {loading ? "FINDING..." : "+ ADD PRODUCT"}
            </button>
          </form>

          {hasSearched && results.length > 0 && (
            <div className="search-results-overlay">
              <div className="results-header">
                <span className="results-header-title uppercase font-black text-[10px] tracking-widest text-[#1e293b]">
                  MATCHES IN {activeCatalog === "all" ? "ALL CATALOGS" : activeCatalog.toUpperCase()}
                </span>
                <button className="results-close-btn" onClick={() => setHasSearched(false)}>×</button>
              </div>
              <div className="results-container grouped-results">
                {groupedResults.map((group) => (
                  <div key={group.baseCode} className="variant-group-block">
                    <div className="variant-group-header">
                      <span className="variant-group-title">{group.baseCode}</span>
                      <div className="variant-chip-row">
                        {group.items.map((item) => (
                          <span key={`${group.baseCode}-${item.code}`} className="variant-chip">{item.variant || "BASE"}</span>
                        ))}
                      </div>
                    </div>
                    <div className="variant-card-grid">
                      {group.items.map((product) => (
                        <div
                          key={`${product.source}-${product.code}`}
                          className={product.isCp ? "variant-card cp-card" : "variant-card"}
                          onClick={() => addToBom(product)}
                        >
                          <div className="variant-image-wrap">
                            <img
                              src={buildProductImageUrl(product)}
                              alt=""
                              className="clickable-image"
                              onClick={(event) => openImagePreview(event, product)}
                              onError={(event) => handleProductImageError(event, product)}
                            />
                            {!product.isCp && product.price > 0 && (
                              <span className="variant-price-overlay">{currencyFormatter.format(product.price)}</span>
                            )}
                            {!product.isCp && product.price <= 0 && (
                              <span className="variant-price-na">Price Not Available</span>
                            )}
                          </div>
                          <div className="variant-card-meta">
                            <span className="variant-code-text">{product.code}</span>
                            <span className="variant-finish-text">{product.color || product.variant || "Standard"}</span>
                            {product.isCp && product.price > 0 && (
                              <span className="variant-price-inline">{currencyFormatter.format(product.price)}</span>
                            )}
                            {product.isCp && product.price <= 0 && (
                              <span className="variant-price-inline variant-price-inline-na">Price Not Available</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bom-section">
          <table className="bom-table">
            <thead>
              <tr>
                <th>CODE</th>
                <th>PRODUCT NAME</th>
                <th>SIZE</th>
                <th>COLOR</th>
                <th>QTY</th>
                <th>RATE</th>
                {discountConfig.method === "item-wise" && <th>DISC%</th>}
                <th>AMOUNT</th>
                <th>ROOM</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bom.length === 0 ? (
                <tr><td colSpan="10" className="empty-bom">No products added. Use search to build your BOM.</td></tr>
              ) : (
                bom.map((item) => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td className="col-product">
                      <div className="product-info-cell">
                        <img
                          src={buildProductImageUrl(item)}
                          alt=""
                          className="clickable-image"
                          onClick={(event) => openImagePreview(event, item)}
                          onError={(event) => handleProductImageError(event, item)}
                        />
                        <span>{item.name}</span>
                      </div>
                    </td>
                    <td><input className="table-input" value={item.size} onChange={(e) => updateBomItem(item.id, "size", e.target.value)} /></td>
                    <td><input className="table-input" value={item.color} onChange={(e) => updateBomItem(item.id, "color", e.target.value)} /></td>
                    <td className="col-small"><input className="table-input" type="number" min="1" value={item.qty} onChange={(e) => updateBomItem(item.id, "qty", parseInt(e.target.value) || 0)} /></td>
                    <td><input className="table-input" type="number" value={item.rate} onChange={(e) => updateBomItem(item.id, "rate", parseFloat(e.target.value) || 0)} /></td>
                    {discountConfig.method === "item-wise" && (
                      <td className="col-small"><input className="table-input" type="number" min="0" max="100" value={item.discount} onChange={(e) => updateBomItem(item.id, "discount", parseFloat(e.target.value) || 0)} /></td>
                    )}
                    <td className="col-amount">{currencyFormatter.format(calculateRowAmount(item))}</td>
                    <td>
                      <select className="room-select" value={item.room} onChange={(e) => updateBomItem(item.id, "room", e.target.value)}>
                        <option value="">Select Room</option>
                        {roomOptions.map((room) => (<option key={room} value={room}>{room}</option>))}
                      </select>
                    </td>
                    <td><button className="delete-btn" onClick={() => removeBomItem(item.id)}>🗑️</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 2. DISCOUNT CONFIGURATION SECTION (BOTTOM) */}
        <div className="discount-config-section card-box mt-12">
          <h2 className="section-title">% Discount Configuration</h2>
          <div className="config-grid">
            <div className="method-switcher">
               <label className="label-lite">Discount Method</label>
               <div className="btn-group">
                 <button className={discountConfig.method === 'item-wise' ? 'btn-select is-on' : 'btn-select'} onClick={() => setDiscountConfig({...discountConfig, method: 'item-wise'})}>Item Wise</button>
                 <button className={discountConfig.method === 'common' ? 'btn-select is-on' : 'btn-select'} onClick={() => setDiscountConfig({...discountConfig, method: 'common'})}>Common %</button>
                 <button className={discountConfig.method === 'on-total' ? 'btn-select is-on' : 'btn-select'} onClick={() => setDiscountConfig({...discountConfig, method: 'on-total'})}>On Total</button>
               </div>
            </div>

            {discountConfig.method === 'common' && (
              <div className="field-group">
                <label>Bulk Discount %</label>
                <input type="number" value={discountConfig.bulkDiscount} onChange={(e) => setDiscountConfig({...discountConfig, bulkDiscount: parseFloat(e.target.value) || 0})} />
              </div>
            )}
            {discountConfig.method === 'on-total' && (
              <div className="field-group">
                <label>Flat Discount Amount</label>
                <input type="number" value={discountConfig.flatDiscount} onChange={(e) => setDiscountConfig({...discountConfig, flatDiscount: parseFloat(e.target.value) || 0})} />
              </div>
            )}

            <div className="watermark-group">
              <label className="toggle-label font-bold text-sm text-[#1e293b]">
                <input type="checkbox" className="toggle-input" checked={discountConfig.watermark} onChange={(e) => setDiscountConfig({...discountConfig, watermark: e.target.checked})} />
                PDF Branding - Watermark ON/OFF
              </label>
            </div>
          </div>

          <div className="summary-section mt-8">
             <div className="summary-row">
               <span>Subtotal:</span>
               <span>{currencyFormatter.format(subtotal)}</span>
             </div>
             {discountConfig.method !== "item-wise" && (
                <div className="summary-row text-red-500">
                  <span>Discount:</span>
                  <span>- {currencyFormatter.format(subtotal - finalBeforeGst)}</span>
                </div>
             )}
              {clientInfo.gstCompliance && (
                <div className="summary-row text-emerald-600">
                  <span>GST ({clientInfo.gstPercentage}%):</span>
                  <span>+ {currencyFormatter.format(totalGst)}</span>
                </div>
              )}
             <div className="summary-row total-highlight">
               <span>Grand Total:</span>
               <span>{currencyFormatter.format(grandTotal)}</span>
             </div>
          </div>
        </div>

        <div className="action-buttons mt-12 flex justify-end gap-4 p-6">
            <button className="btn-pro btn-save" disabled={pdfGenerating}>Save Quote</button>
            <button className="btn-pro btn-view" onClick={() => generatePdf(true)} disabled={pdfGenerating}>{pdfGenerating ? "GENERATING..." : "View PDF"}</button>
            <button className="btn-pro btn-generate" onClick={() => generatePdf(false)} disabled={pdfGenerating}>{pdfGenerating ? "GENERATING..." : "Generate PDF"}</button>
        </div>

        {pdfPreviewUrl && (
          <div className="pdf-preview-overlay" role="dialog" aria-modal="true">
            <div className="pdf-preview-modal">
              <div className="pdf-preview-header">
                <div className="pdf-preview-title-wrap">
                  <h3>Quotation Preview</h3>
                  <p>Review your document before sending</p>
                </div>
                <div className="pdf-preview-actions">
                  <div className="pdf-zoom-controls">
                    <button type="button" className="pdf-zoom-btn" onClick={() => setPdfZoom((value) => Math.max(60, value - 10))}>-</button>
                    <span>{pdfZoom}%</span>
                    <button type="button" className="pdf-zoom-btn" onClick={() => setPdfZoom((value) => Math.min(200, value + 10))}>+</button>
                    <button type="button" className="pdf-zoom-reset" onClick={() => setPdfZoom(100)}>Reset</button>
                  </div>
                  <button className="btn-pro btn-view" onClick={downloadPreviewPdf}>Download PDF</button>
                  <button className="pdf-close-btn" onClick={closePdfPreview} aria-label="Close preview">×</button>
                </div>
              </div>
              <div className="pdf-frame-wrap">
                <div className="pdf-frame-canvas">
                  <iframe
                    title="Quotation PDF Preview"
                    src={pdfPreviewUrl}
                    className="pdf-frame"
                    style={{
                      transform: `scale(${pdfZoom / 100})`,
                      transformOrigin: "top left",
                      width: `${100 / (pdfZoom / 100)}%`,
                      height: `${100 / (pdfZoom / 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {imagePreview.isOpen && (
          <div className="image-lightbox-overlay" onClick={closeImagePreview} role="dialog" aria-modal="true">
            <div className="image-lightbox-modal" onClick={(event) => event.stopPropagation()}>
              <div className="image-lightbox-header">
                <strong>{imagePreview.title}</strong>
                <div className="image-lightbox-actions">
                  <button
                    type="button"
                    className="image-lightbox-btn"
                    onClick={() => setImagePreview((prev) => ({ ...prev, zoom: Math.max(0.5, prev.zoom - 0.1) }))}
                  >
                    -
                  </button>
                  <span>{Math.round(imagePreview.zoom * 100)}%</span>
                  <button
                    type="button"
                    className="image-lightbox-btn"
                    onClick={() => setImagePreview((prev) => ({ ...prev, zoom: Math.min(4, prev.zoom + 0.1) }))}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="image-lightbox-btn"
                    onClick={() => setImagePreview((prev) => ({ ...prev, zoom: 1 }))}
                  >
                    100%
                  </button>
                  <button type="button" className="pdf-close-btn" onClick={closeImagePreview} aria-label="Close image">×</button>
                </div>
              </div>
              <div className="image-lightbox-body">
                <img
                  src={imagePreview.src}
                  alt={imagePreview.title}
                  style={{ transform: `scale(${imagePreview.zoom})` }}
                  onError={(event) => {
                    event.currentTarget.src =
                      getPublicFallbackImageUrl() ||
                      buildPlaceholder(imagePreview.title || "Catalog product");
                  }}
                />
              </div>
            </div>
          </div>
        )}

      </section>
      <footer className="page-footer">© 2026 Pro Quotation Dashboard</footer>
    </main>
  );
}

export default App;
