from PIL import Image, ImageDraw, ImageFont
S=1024; G=(3,199,90); W=(255,255,255); DG=(2,150,68)
F=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',200) if False else None
import glob
fp=[f for f in glob.glob('/usr/share/fonts/**/*.tt*',recursive=True) if 'Bold' in f and ('Noto' in f or 'Dejavu' in f.lower() or 'DejaVu' in f)]
font=lambda s: ImageFont.truetype(fp[0],s)
def base():
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    p=128  # 16px pad at 128 scale
    d.rounded_rectangle([p,p,S-p,S-p],radius=150,fill=G)
    return im,d
def photo(d,box,fill=W,fg=G,r=40,stroke=None):
    x0,y0,x1,y1=box; d.rounded_rectangle(box,radius=r,fill=fill,outline=stroke,width=18 if stroke else 0)
    w=x1-x0;h=y1-y0
    # mountains + sun
    d.polygon([(x0+w*.12,y1-h*.15),(x0+w*.42,y0+h*.38),(x0+w*.62,y1-h*.15)],fill=fg)
    d.polygon([(x0+w*.45,y1-h*.15),(x0+w*.68,y0+h*.52),(x0+w*.9,y1-h*.15)],fill=fg)
    rr=w*.09; cx,cy=x0+w*.75,y0+h*.28; d.ellipse([cx-rr,cy-rr,cx+rr,cy+rr],fill=fg)
def badge(d,c,n,r=62):
    d.ellipse([c[0]-r,c[1]-r,c[0]+r,c[1]+r],fill=(255,196,0),outline=G,width=14)
    f=font(int(r*1.3)); d.text(c,str(n),font=f,fill=(30,30,30),anchor='mm')
# A: three photos stacked diagonally, numbered
im,d=base()
for i,(x,y) in enumerate([(230,250),(330,370),(430,490)]):
    photo(d,(x,y,x+360,y+270),fill=W,stroke=G)
for i,(x,y) in enumerate([(230,250),(330,370),(430,490)]):
    pass
badge(d,(800,780),'1→3'[0]); 
im.save('A.png')
# A2 clean: stacked photos + numbers on each
im,d=base()
pos=[(220,220),(330,345),(440,470)]
for i,(x,y) in enumerate(pos):
    photo(d,(x,y,x+370,y+280),stroke=G)
for i,(x,y) in enumerate(pos):
    badge(d,(x+30,y+30),i+1,r=70)
im.save('A.png')
# B: ordered list of photo rows with numbers
im,d=base()
for i in range(3):
    y=235+i*190
    f=font(130); d.text((300,y+70),str(i+1),font=f,fill=W,anchor='mm')
    photo(d,(390,y,800,y+150),r=30)
im.save('B.png')
# C: one photo + sort arrow
im,d=base()
photo(d,(210,260,640,600),r=50)
photo(d,(250,420,680,760),r=50,stroke=G)
d.line([(800,260),(800,700)],fill=W,width=64)
d.polygon([(700,640),(900,640),(800,790)],fill=W)
im.save('C.png')
# preview sheet
KF=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',20)
sheet=Image.new('RGB',(900,420),(245,246,248)); sd=ImageDraw.Draw(sheet)
for k,name in enumerate('ABC'):
    ic=Image.open(name+'.png')
    x=40+k*290
    for j,sz in enumerate([128,48,16]):
        r=ic.resize((sz,sz),Image.LANCZOS)
        xx=x+[0,150,220][j]; sheet.paste(r,(xx,80+(128-sz)//2),r)
    dark=Image.new('RGB',(250,150),(40,42,46)); 
    for j,sz in enumerate([48,16]):
        r=ic.resize((sz,sz),Image.LANCZOS); dark.paste(r,(40+j*90,50+(48-sz)//2),r)
    sheet.paste(dark,(x,240))
    sd.text((x,30),{'A':'A안 · 사진 묶음+번호','B':'B안 · 번호 매긴 사진 목록','C':'C안 · 사진+정렬 화살표'}[name],font=KF,fill=(20,20,20))
sheet.save('compare.png')
