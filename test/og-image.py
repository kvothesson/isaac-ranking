# Genera web/og.png, la imagen que muestran Reddit, Steam, Discord y Twitter
# cuando alguien pega el link. 1200x630 es la medida que esperan todos.
#
#   python test/og-image.py
#
# Se dibuja por codigo y no se saca de una captura para que el texto quede
# nitido y no dependa del estado del ranking en el momento de sacarla.

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG, PANEL, LINE = (13, 11, 12), (22, 18, 19), (42, 35, 37)
TEXT, DIM, BLOOD, GOLD = (232, 223, 214), (138, 124, 120), (179, 37, 42), (217, 164, 65)

F = "C:/Windows/Fonts/consolab.ttf"
FR = "C:/Windows/Fonts/consola.ttf"
titulo = ImageFont.truetype(F, 86)
sub = ImageFont.truetype(FR, 27)
fila = ImageFont.truetype(F, 30)
filaR = ImageFont.truetype(FR, 30)
chico = ImageFont.truetype(F, 19)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# Resplandor de arriba, imitando el radial-gradient del sitio.
for y in range(300):
    k = (1 - y / 300) ** 2
    d.line([(0, y), (W, y)], fill=(int(13 + 16 * k), int(11 + 10 * k), int(12 + 11 * k)))

# Titulo centrado, en dos colores como en la pagina.
t1, t2 = "ISAAC ", "RANKING"
w1 = d.textlength(t1, font=titulo)
w2 = d.textlength(t2, font=titulo)
x = (W - w1 - w2) / 2
d.text((x, 66), t1, font=titulo, fill=BLOOD)
d.text((x + w1, 66), t2, font=titulo, fill=TEXT)

for i, linea in enumerate([
    "Ranked by achievements unlocked.",
    "Ties are broken by rarity: the fewer people have it, the more it is worth.",
]):
    w = d.textlength(linea, font=sub)
    d.text(((W - w) / 2, 178 + i * 36), linea, font=sub, fill=DIM)

# Tabla de muestra. Son datos reales del ranking, no inventados.
top, alto = 290, 78
d.rounded_rectangle([70, top, W - 70, top + alto * 3 + 16], 14, fill=PANEL, outline=LINE, width=2)

filas = [
    ("1", "boop", "641/641", "509.7", True),
    ("2", "Melvor", "412/641", "264.6", False),
    ("3", "3Ezee", "410/641", "260.2", False),
]
for i, (pos, nombre, logros, rareza, dg) in enumerate(filas):
    y = top + 18 + i * alto
    if dg:
        d.rounded_rectangle([72, y - 6, W - 72, y + alto - 22], 8, fill=(30, 24, 20))
    d.text((110, y), pos, font=fila, fill=GOLD if dg else DIM)
    d.text((165, y), nombre, font=fila, fill=TEXT)
    if dg:
        bx = 165 + d.textlength(nombre, font=fila) + 18
        d.rounded_rectangle([bx, y + 4, bx + 132, y + 32], 5, outline=GOLD, width=2)
        d.text((bx + 12, y + 9), "DEAD GOD", font=chico, fill=GOLD)
    d.text((700, y), logros, font=filaR, fill=TEXT)
    d.text((940, y), rareza, font=filaR, fill=GOLD)

pie = "isaac.kvothesson.com   ::   public Steam data, no login"
w = d.textlength(pie, font=sub)
d.text(((W - w) / 2, 560), pie, font=sub, fill=DIM)

img.save("web/og.png", optimize=True)
print("web/og.png", img.size)
