"""Genera el icono de Dual Pulse: dos anillos concentricos desfasados.

Dibuja a 8x y reduce, que es la forma de tener antialiasing decente en PIL sin
depender de un rasterizador de SVG. Colores tomados del codigo real de la app:
CA = #ff6b4a (metronomo A), CB = #4ad9ff (metronomo B), fondo #15171c.
"""
from PIL import Image, ImageDraw
import math, os

BG = (0x15, 0x17, 0x1c, 255)
CA = (0xff, 0x6b, 0x4a, 255)   # A - coral
CB = (0x4a, 0xd9, 0xff, 255)   # B - celeste
WHITE = (255, 255, 255, 255)

SS = 8  # supermuestreo


def draw_icon(size, bleed=True):
    """Dibuja el icono a `size` px. bleed=True -> fondo cuadrado redondeado."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Fondo: cuadrado redondeado (radio 22% como los iconos modernos de Windows)
    if bleed:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)

    cx = cy = S / 2

    # A 16-24 px no hay pixeles para puntos de pulso: se empastan y ensucian el
    # anillo. En esos tamanos el icono se reduce a lo unico que sobrevive —
    # dos anillos concentricos de distinto color, mas gruesos y mas separados.
    small = size <= 24
    if small:
        ring_w = S * 0.105
        r_out, r_in = S * 0.345, S * 0.165
    else:
        ring_w = S * 0.072
        r_out, r_in = S * 0.335, S * 0.190

    def ring(r, color, gap_deg, gap_at):
        """Anillo con un hueco, para que se lea como ciclo y no como circulo."""
        start = gap_at + gap_deg / 2
        end = gap_at - gap_deg / 2 + 360
        d.arc([cx - r, cy - r, cx + r, cy + r], start, end,
              fill=color, width=int(ring_w))

    # Los huecos miran a lados opuestos: refuerza la idea de dos ciclos distintos
    gap = 34 if small else 46
    ring(r_out, CA, gap, 270)   # hueco arriba
    ring(r_in, CB, gap, 90)     # hueco abajo
    if small:
        return img.resize((size, size), Image.LANCZOS)

    def dot(r, ang_deg, color):
        """Punto de pulso sobre el anillo. Sin halo: a 16 px el halo se lee como
        mancha gris, no como brillo. El nucleo blanco solo entra en tamanos
        grandes, donde hay pixeles suficientes para que no se empaste."""
        a = math.radians(ang_deg)
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        rr = ring_w * 0.92
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color)
        if size >= 48:
            c = rr * 0.34
            d.ellipse([x - c, y - c, x + c, y + c], fill=WHITE)

    # Desfasados a proposito: A en el "1", B ya corrido. Eso ES la app.
    dot(r_out, -90, CA)    # A arriba (12 en punto)
    dot(r_in, 40, CB)      # B corrido

    return img.resize((size, size), Image.LANCZOS)


out_dir = os.path.dirname(os.path.abspath(__file__))
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [draw_icon(s) for s in sizes]

# .ico multi-resolucion para Windows / electron-builder
ico_path = os.path.join(out_dir, "icon.ico")
frames[-1].save(ico_path, format="ICO",
                sizes=[(s, s) for s in sizes])

# PNG grande para previsualizar y para electron-builder si lo pide
frames[-1].save(os.path.join(out_dir, "icon-256.png"))
draw_icon(512).save(os.path.join(out_dir, "icon-512.png"))

# Tira de previsualizacion a tamanos reales, sobre gris medio
strip_sizes = [16, 24, 32, 48, 64, 128, 256]
pad = 16
W = sum(strip_sizes) + pad * (len(strip_sizes) + 1)
H = 256 + pad * 2
strip = Image.new("RGBA", (W, H), (0x80, 0x84, 0x8c, 255))
x = pad
for s in strip_sizes:
    f = draw_icon(s)
    strip.paste(f, (x, H - pad - s), f)
    x += s + pad
strip.save(os.path.join(out_dir, "preview.png"))

print("ico:", ico_path, os.path.getsize(ico_path), "bytes")
print("tamanos:", sizes)
