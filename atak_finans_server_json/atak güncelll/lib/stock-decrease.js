'use strict';

/** Tek kalem stok düşümü: sayım hedefi değil, kaç adet eksileceği. */

function plannedDecrease(currentQty, reservedQty, dropQty){
  const current = Math.max(0, Math.round(Number(currentQty) || 0));
  const reserved = Math.max(0, Math.round(Number(reservedQty) || 0));
  const n = Math.max(0, Math.round(Number(dropQty) || 0));
  const available = Math.max(0, current - reserved);
  if(!n) return { ok: false, error: 'Düşülecek adet 1 veya daha fazla olmalı' };
  if(n > available){
    return {
      ok: false,
      error: reserved
        ? `Satılabilir ${available} adet (rezerve ${reserved}). ${n} düşülemez.`
        : `Bu depoda ${current} adet var, ${n} düşülemez.`
    };
  }
  return { ok: true, current, reserved, available, drop: n, after: current - n, delta: -n };
}

module.exports = { plannedDecrease };
