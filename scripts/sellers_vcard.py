"""vCard payloads used by QR generation."""

COMPANY = "ATAK EV GEREÇLERİ PAZ. TİC. LTD. ŞTİ."

SELLERS = [
    {
        "id": 1,
        "name": "Muhammed Emir ATAK",
        "mobile": "05403431312",
        "email": "emir.atak@atakhome.com.tr",
        "landline": "02122232871",
        "address": "Ferahevler Mah. Adnankahveci Cad. No:109 Sarıyer/İSTANBUL",
    },
    {
        "id": 2,
        "name": "Taha Yasin ATAK",
        "mobile": "05433585060",
        "email": "taha.atak@atakhome.com.tr",
        "landline": "02122232871",
        "address": "Ferahevler Mah. Adnankahveci Cad. No:109 Sarıyer/İSTANBUL",
    },
    {
        "id": 3,
        "name": "Emine Yakışır",
        "mobile": "05333326991",
        "email": "emine.yakisir@atakhome.com.tr",
        "landline": "02122625651",
        "address": "Ferahevler Mah. Adnan Kahveci Cad. No:24 Sarıyer/İSTANBUL",
    },
]


def vcard(seller: dict) -> str:
    parts = seller["name"].split(" ")
    last = parts[-1]
    first = " ".join(parts[:-1])
    return "\n".join(
        [
            "BEGIN:VCARD",
            "VERSION:3.0",
            f"FN:{seller['name']}",
            f"N:{last};{first};;;",
            f"ORG:{COMPANY}",
            f"TEL;TYPE=CELL:{seller['mobile']}",
            f"TEL;TYPE=WORK:{seller['landline']}",
            f"EMAIL:{seller['email']}",
            f"ADR;TYPE=WORK:;;{seller['address']};;;;Türkiye",
            "END:VCARD",
        ]
    )


def vcards() -> dict[int, str]:
    return {s["id"]: vcard(s) for s in SELLERS if s.get("name")}
