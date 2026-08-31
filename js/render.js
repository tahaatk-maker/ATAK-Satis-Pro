import { COMPANY } from "./sellers.js";

const ATAK_A = `
  <svg class="atak-a" viewBox="0 0 120 108" aria-hidden="true">
    <path fill="currentColor" d="M60 4 L116 104 H91 L60 42 L48 66 H34 L50 36 L32 104 H4 Z"/>
  </svg>
`;

const BEKO_MARK = `
  <div class="beko-mark">
    <span class="beko-word">beko</span>
    <svg class="beko-slash" viewBox="0 0 64 8" aria-hidden="true">
      <polygon points="0,7 56,7 64,1 8,1" fill="currentColor"/>
    </svg>
  </div>
`;

const ISTIKBAL_MARK = `
  <div class="istikbal-mark">
    <svg class="istikbal-waves" viewBox="0 0 30 22" aria-hidden="true">
      <g fill="none" stroke="#F5C400" stroke-width="2.35" stroke-linecap="round">
        <path d="M1.2 4.2 C5.2 1.2 9.2 7.2 13.5 4.2 S22 1.2 28.6 4.2"/>
        <path d="M1.2 11 C5.2 8 9.2 14 13.5 11 S22 8 28.6 11"/>
        <path d="M1.2 17.8 C5.2 14.8 9.2 20.8 13.5 17.8 S22 14.8 28.6 17.8"/>
      </g>
    </svg>
    <span class="istikbal-word">istikbal</span>
  </div>
`;

function brandLockup(theme) {
  return `
    <div class="lockup lockup-${theme}">
      <div class="atak-mark">
        ${ATAK_A}
        <span class="atak-word">ATAK</span>
      </div>
      <span class="lockup-rule"></span>
      <div class="lockup-partners">
        ${BEKO_MARK}
        ${ISTIKBAL_MARK}
      </div>
    </div>
  `;
}

function frontWaves(uid) {
  return `
    <svg class="waves" viewBox="0 0 900 500" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${uid}-navy" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0a3a6e"/>
          <stop offset="1" stop-color="#06284c"/>
        </linearGradient>
        <linearGradient id="${uid}-mid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1a73c4"/>
          <stop offset="1" stop-color="#0e4f8c"/>
        </linearGradient>
        <linearGradient id="${uid}-sky" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#3ea0dc"/>
          <stop offset="1" stop-color="#7ec8ef"/>
        </linearGradient>
      </defs>
      <path fill="url(#${uid}-navy)" d="M0,0 H268 C300,70 238,150 276,230 C318,322 236,390 270,500 H0 Z"/>
      <path fill="url(#${uid}-mid)" opacity="0.9" d="M0,40 C150,70 210,140 188,230 C164,330 250,390 210,500 H0 Z"/>
      <path fill="url(#${uid}-sky)" opacity="0.55" d="M0,0 C120,30 90,110 170,170 C250,232 150,310 200,500 H0 Z"/>
      <path fill="#8fd0f3" opacity="0.35" d="M0,210 C90,190 140,260 120,330 C96,410 170,450 150,500 H0 Z"/>
    </svg>
  `;
}

function backWaves(uid) {
  return `
    <svg class="waves" viewBox="0 0 900 500" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${uid}-bnavy" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#08325c"/>
          <stop offset="1" stop-color="#0c4a86"/>
        </linearGradient>
        <linearGradient id="${uid}-bmid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1c7ed0"/>
          <stop offset="1" stop-color="#0e5aa0"/>
        </linearGradient>
        <linearGradient id="${uid}-bsky" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#67b8e8"/>
          <stop offset="1" stop-color="#2b8fd0"/>
        </linearGradient>
      </defs>
      <path fill="url(#${uid}-bnavy)" d="M900,0 H620 C560,90 700,170 640,270 C575,385 690,430 650,500 H900 Z"/>
      <path fill="url(#${uid}-bmid)" d="M900,40 C760,90 700,180 740,270 C785,370 680,430 720,500 H900 Z"/>
      <path fill="url(#${uid}-bsky)" opacity="0.95" d="M900,0 C790,40 820,130 740,190 C650,260 780,340 700,500 H900 Z"/>
      <path fill="#9ad6f4" opacity="0.45" d="M900,260 C820,230 780,310 800,370 C825,440 760,470 780,500 H900 Z"/>
    </svg>
  `;
}

function icon(name) {
  return `<span class="icon"><svg viewBox="0 0 24 24"><use href="#icon-${name}"></use></svg></span>`;
}

export function frontCardHTML(seller, complete) {
  const uid = `f${seller.id}`;
  const name = complete ? seller.name : `Satıcı ${seller.id}`;
  const mobile = complete ? seller.mobile : "Cep bekleniyor";
  const email = complete ? seller.email : "E-posta bekleniyor";
  const qr = complete
    ? `<img class="qr" alt="QR kod" src="./assets/qr/satici-${seller.id}.png">`
    : "";
  const landline = seller.landline || COMPANY.defaultLandline;
  const address = seller.address || COMPANY.defaultAddress;

  return `
    <article class="card front ${complete ? "" : "pending"}" data-side="front" data-seller="${seller.id}">
      ${frontWaves(uid)}
      <div class="texture"></div>
      <div class="brand-panel">
        ${brandLockup("light")}
      </div>
      <div class="info">
        <div class="company">${COMPANY.legalName}</div>
        <div class="person">${name}</div>
        <div class="info-bottom">
          <div class="contacts">
            <div class="row">${icon("mobile")}<span>${mobile}</span></div>
            <div class="row">${icon("mail")}<span>${email}</span></div>
            <div class="row">${icon("phone")}<span>${landline}</span></div>
            <div class="row">${icon("pin")}<span>${address}</span></div>
          </div>
          ${qr}
        </div>
      </div>
    </article>
  `;
}

export function backCardHTML(seller, complete) {
  const uid = `b${seller.id}`;
  return `
    <article class="card back ${complete ? "" : "pending"}" data-side="back" data-seller="${seller.id}">
      <div class="texture"></div>
      ${backWaves(uid)}
      <div class="brand-stack">
        <img class="lockup-photo" src="./assets/logos/brand-lockup.png" alt="ATAK, beko ve istikbal">
      </div>
    </article>
  `;
}
