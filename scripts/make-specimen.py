#!/usr/bin/env python3
"""見本の旅券画像を作る（ICAO Doc 9303 の架空の国 Utopia。SPECIMEN と明記。本物の旅券には似せない）。D-07, D-26"""
import sys
from PIL import Image, ImageDraw, ImageFont

def cd(s):
    w=[7,3,1];t=0
    for i,c in enumerate(s):
        v=int(c) if c.isdigit() else (ord(c)-55 if c.isalpha() else 0)
        t+=v*w[i%3]
    return t%10

def td3(issuing,surname,given,number,nat,birth,sex,expiry):
    pad=lambda s,n:(s+'<'*n)[:n]
    l1=pad(f"P<{issuing}{surname.upper().replace(' ','<')}<<{given.upper().replace(' ','<')}",44)
    num=pad(number.upper(),9); personal=pad('',14)
    body=f"{num}{cd(num)}{nat}{birth}{cd(birth)}{sex}{expiry}{cd(expiry)}{personal}{cd(personal)}"
    comp=f"{num}{cd(num)}{birth}{cd(birth)}{expiry}{cd(expiry)}{personal}{cd(personal)}"
    return l1, f"{body}{cd(comp)}"

def make(path, surname, given, number, birth_h, birth, expiry_h, expiry, sex):
    W,H=1250,880
    im=Image.new('RGB',(W,H),(246,242,232)); d=ImageDraw.Draw(im)
    def F(sz,bold=False,mono=False):
        try:
            if mono: return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',sz)
            return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',sz)
        except Exception: return ImageFont.load_default()
    d.rectangle([0,0,W,90],fill=(31,27,22))
    d.text((40,22),'UTOPIA',font=F(40,True),fill=(246,242,232)); d.text((W-520,30),'PASSPORT / PASSEPORT',font=F(28,True),fill=(246,242,232))
    # photo box
    d.rectangle([40,130,340,500],outline=(120,110,100),width=3,fill=(220,214,200))
    d.ellipse([130,180,250,300],fill=(150,140,130)); d.chord([90,300,290,520],0,180,fill=(150,140,130))
    d.text((60,470),'SPECIMEN',font=F(36,True),fill=(200,64,30))
    x=400; y=130
    rows=[('Type / Type','P'),('Code / Code','UTO'),('Passport No. / No du passeport',number),('Surname / Nom',surname.upper()),('Given names / Prénoms',given.upper()),('Nationality / Nationalité','UTOPIAN'),('Date of birth / Date de naissance',birth_h),('Sex / Sexe',sex),('Date of expiry / Date d\'expiration',expiry_h),('Authority / Autorité','UTOPIA')]
    for i,(k,v) in enumerate(rows):
        col=0 if i<6 else 1
        yy=y+(i if i<6 else i-6)*62; xx=x+col*430
        d.text((xx,yy),k,font=F(16),fill=(110,100,90)); d.text((xx,yy+22),v,font=F(28,True),fill=(31,27,22))
    # watermark
    wm=Image.new('RGBA',(W,H),(0,0,0,0)); wd=ImageDraw.Draw(wm)
    wd.text((330,330),'SPECIMEN',font=F(150,True),fill=(200,64,30,60)); wm=wm.rotate(-18,resample=Image.BICUBIC)
    im.paste(Image.alpha_composite(im.convert('RGBA'),wm).convert('RGB'))
    d=ImageDraw.Draw(im)
    l1,l2=td3('UTO',surname,given,number,'UTO',birth,sex,expiry)
    d.rectangle([0,690,W,H],fill=(255,255,255))
    d.text((40,715),l1,font=F(40,mono=True),fill=(31,27,22)); d.text((40,790),l2,font=F(40,mono=True),fill=(31,27,22))
    d.text((40,H-30),'SPECIMEN — fictional document for testing qr-yado. Not a real passport. Utopia is the example state of ICAO Doc 9303.',font=F(14),fill=(110,100,90))
    im.save(path); print(path,l1,l2)

make('fixtures/specimen-passport-churchill.png','CHURCHILL','WINSTON','TEST00101','30 NOV 1974','741130','30 NOV 2030','301130','M')
make('fixtures/specimen-passport-degaulle.png','DE GAULLE','CHARLES','TEST00102','22 NOV 1970','701122','22 NOV 2031','311122','M')
