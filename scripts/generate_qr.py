from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_M

from sellers_vcard import vcards

OUT = Path(__file__).resolve().parents[1] / "assets" / "qr"
OUT.mkdir(parents=True, exist_ok=True)

for seller_id, payload in vcards().items():
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=12, border=1)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    path = OUT / f"satici-{seller_id}.png"
    img.save(path)
    print("wrote", path)
