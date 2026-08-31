import { SELLERS, isComplete } from "./sellers.js";
import { frontCardHTML, backCardHTML } from "./render.js";

const root = document.getElementById("cards");
if (root) {
  root.innerHTML = SELLERS.map((seller) => {
    const complete = isComplete(seller);
    return `
      <section class="seller-block ${complete ? "" : "pending"}" data-seller="${seller.id}">
        <h2>${complete ? seller.name : `Satıcı ${seller.id}`} — ${complete ? "hazır" : "bilgi bekleniyor"}</h2>
        ${
          complete
            ? ""
            : `<p class="placeholder-note">İsim, cep ve e-posta gelince bu kart doldurulur. Firma unvanı, sabit hat ve adres tüm kartlarda aynıdır.</p>`
        }
        <div class="pair">
          <div class="stage">${frontCardHTML(seller, complete)}</div>
          <div class="stage">${backCardHTML(seller, complete)}</div>
        </div>
      </section>
    `;
  }).join("");
}

document.getElementById("print-btn")?.addEventListener("click", () => window.print());
