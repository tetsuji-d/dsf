"""Generate only the three synthetic Viewer sample books, never authoring data."""
import base64, io, json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
OUT = Path(__file__).resolve().parents[1] / 'outputs'
FONT = 'C:/Windows/Fonts/YuGothM.ttc'
SERIF = 'C:/Windows/Fonts/yumin.ttf'
def font(n, serif=False): return ImageFont.truetype(SERIF if serif else FONT, n*2)
def page_image(i, total):
    im=Image.new('RGB',(720,1280),'#f5f1e7'); d=ImageDraw.Draw(im)
    palettes=[('#1a5664','#dca958','#dfe9e3'),('#ae593e','#e5b970','#f1ded0'),('#536548','#a6b585','#e6e9db'),('#3d527b','#a9bfd5','#e2e8f1'),('#7a4864','#d4969b','#f0e0e7'),('#866f39','#c7b887','#eee9d8')]
    ink,accent,pale=palettes[(i//2)%len(palettes)]
    def text(x,y,s,size=13,color=ink,serif=False): d.text((x*2,y*2),s,font=font(size,serif),fill=color)
    def rect(box,fill): d.rectangle(tuple(v*2 for v in box),fill=fill)
    def line(points,fill=ink,width=1):d.line([(x*2,y*2) for x,y in points],fill=fill,width=width*2)
    def ellipse(box,fill): d.ellipse(tuple(v*2 for v in box),fill=fill)
    def polygon(points,fill):d.polygon([(x*2,y*2) for x,y in points],fill=fill)
    if i in (0,total-1):
        rect((0,0,360,640),ink)
        text(30,58,'COASTAL / FIELD NOTES',12,'#f5f1e7')
        ellipse((145,170,295,320),accent)
        for k in range(8): line([(30,335+k*12),(95,310+k*12),(210,345+k*12),(330,325+k*12)],'#dfe9e3',2)
        text(30,430,'海辺の採集帖' if i==0 else 'また、海辺で。',28,'#f5f1e7',True)
        text(30,493,'色・かたち・小さな物語',13,'#f5f1e7')
        text(30,570,f'{total} PAGES / READING STUDY',11,'#f5f1e7')
    elif i in (1,total-2):
        rect((0,0,360,640),pale)
        for y in range(80,570,25):
            for x in range(36,330,30):ellipse((x,y,x+3,y+3),accent)
        rect((58,268,302,362),'#f5f1e7');text(83,292,'海辺の採集帖',23,ink,True)
    else:
        n=i-1;kind=(n-1)%6
        titles=['朝の入り江','灯台までの道','貝殻の標本','港の窓辺','風の記録','夕暮れの手紙']
        text(30,48,f'FIELD NOTE {n:03d}',11)
        text(30,83,titles[kind],28,ink,True);line([(30,132),(330,132)],accent,2)
        if kind==0:
            rect((30,158,330,452),pale);ellipse((208,179,282,253),accent)
            polygon([(30,310),(85+n%40,256),(176,334),(245,283),(330,323),(330,452),(30,452)],ink)
            for k in range(5):line([(30,363+k*16),(120,351+k*16),(220,375+k*16),(330,354+k*16)],pale,2)
            text(30,480,'潮が引くと、白い砂の道が現れる。',13)
            text(30,506,'朝の光を、ひとつずつ拾って歩く。',13)
        elif kind==1:
            rect((30,158,330,487),pale)
            route=[(62,448),(122,397),(98,335),(217,289),(258,209)]
            line(route,accent,5)
            for j,(x,y) in enumerate(route):
                ellipse((x-9,y-9,x+9,y+9),ink);text(x+13,y-8,str(j+1),12)
            polygon([(243,222),(250,173),(268,173),(275,222)],ink)
            text(30,513,f'散歩の距離  {1+n%9}.{n%10} km',16)
            text(30,544,'曲がり角の先に、いつも海がある。',12)
        elif kind==2:
            for j,(x,y) in enumerate([(91,225),(239,240),(110,390),(258,393)]):
                ellipse((x-48,y-48,x+48,y+48),pale)
                for a in range(0,181,15):
                    rad=math.radians(a);line([(x,y+29),(x+45*math.cos(rad),y-40*math.sin(rad))],ink,1)
                text(x-33,y+57,f'{n:02d} — {j+1}',11)
            text(30,522,'波が磨いた、小さなかたち。',15,ink,True)
        elif kind==3:
            rect((30,158,330,458),ink)
            for row in range(3):
                for col in range(3):
                    x=49+col*95;y=185+row*85
                    rect((x,y,x+65,y+57),accent if (row+col+n)%3 else pale)
                    line([(x+33,y),(x+33,y+57)],ink,3)
            text(30,489,'窓に映る空の色は、',16,ink,True)
            text(30,519,'昨日とは少し違っていた。',16,ink,True)
        elif kind==4:
            rect((30,157,330,284),pale)
            for j in range(8):line([(47,184+j*11),(120,174+j*11),(220,191+j*11),(314,174+j*11)],ink,1)
            paragraphs=['図書館の窓を開けると、海からの風が','机の上に置いた地図をそっと揺らした。','見知らぬ町の名前を指でたどりながら、','まだ歩いたことのない道を想像する。','','遠くで船の汽笛が鳴る。読みかけの本に','一枚の葉をはさみ、外へ出ることにした。','今日は、港の向こうまで行ってみよう。']
            for j,t in enumerate(paragraphs):text(30,319+j*25,t,12)
        else:
            rect((30,158,330,469),pale);ellipse((113,206,247,340),accent)
            rect((30,340,330,469),ink)
            for j in range(5):line([(135-j*13,355+j*18),(226+j*12,355+j*18)],accent,2)
            text(30,500,'「また明日」と、海に言った。',16,ink,True)
            text(30,534,'その返事は、波の音にまぎれた。',12)
        # Deliberate variation remains visible even in the 480-page volume.
        rect((30,588,30+min(300,32+n%21*13),591),accent)
        text(30,604,f'COLLECTION {1+(n-1)//6:02d}',9)
    buf=io.BytesIO();im.save(buf,format='WEBP',quality=82,method=4)
    return 'data:image/webp;base64,'+base64.b64encode(buf.getvalue()).decode()
for total in (24,120,480):
    path=OUT/f'book-edges-{total}.json'
    OUT.mkdir(parents=True,exist_ok=True)
    data={'title':'海辺の採集帖','languages':['ja','en'],'defaultLang':'ja','languageConfigs':{'ja':{'pageDirection':'rtl'},'en':{'pageDirection':'ltr'}},'pages':[{'id':f'edge-page-{i}','content':{'backgrounds':{},'bubbles':{}}} for i in range(total)],'book':{'mode':'full','covers':{'c1':{'pageIndex':0},'c2':{'pageIndex':1},'c3':{'pageIndex':total-2},'c4':{'pageIndex':total-1}},'spineDesign':{'title':'海辺の採集帖','author':'読書体験の試作','backgroundColor':'#173d42','textColor':'#f4eddb','fontSize':18}}}
    data['title']='海辺の採集帖';data['book']['spineDesign']['title']=data['title']
    for i,page in enumerate(data['pages']):page['content']['backgrounds']['__all']=page_image(i,total)
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'Generated {total} distinct synthetic pages')
