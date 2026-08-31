import { SELLERS, isComplete } from "./js/sellers.js";
import { frontCardHTML, backCardHTML } from "./js/render.js";

const sheet = document.getElementById("sheet");
if (sheet) {
  const completeSellers = SELLERS.filter(isComplete);
  const list = completeSellers.length ? completeSellers : SELLERS;
  sheet.innerHTML = list
    .flatMap((seller) => {
      const complete = isComplete(seller);
      return [
        `<div class="stage">${frontCardHTML(seller, complete)}</div>`,
        `<div class="stage">${backCardHTML(seller, complete)}</div>`,
      ];
    })
    .join("");
}
