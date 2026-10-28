"""Render the editable history .drawio files to matching PNG previews."""
from pathlib import Path
from xml.etree import ElementTree as ET
from PIL import Image, ImageDraw, ImageFont
import re

ROOT=Path(__file__).resolve().parents[1]
DIR=ROOT/'docs'/'diagrams'
REG=Path('C:/Windows/Fonts/segoeui.ttf')
BOLD=Path('C:/Windows/Fonts/seguisb.ttf')

def style_map(value):
    return dict(part.split('=',1) for part in value.split(';') if '=' in part)

def draw_file(stem):
    source=DIR/(stem+'.drawio')
    graph=ET.parse(source).find('.//mxGraphModel')
    width=int(graph.get('pageWidth')); height=int(graph.get('pageHeight'))
    im=Image.new('RGB',(width,height),'#ffffff'); d=ImageDraw.Draw(im)
    cells={c.get('id'):c for c in graph.findall('.//mxCell')}
    cache={}
    def rect(c):
        ident=c.get('id')
        if ident in cache: return cache[ident]
        g=c.find('mxGeometry')
        if g is None: return (0,0,0,0)
        x=float(g.get('x','0'));y=float(g.get('y','0'))
        w=float(g.get('width','0'));h=float(g.get('height','0'))
        p=c.get('parent')
        if p not in ('0','1',None) and p in cells:
            px,py,_,_=rect(cells[p]);x+=px;y+=py
        cache[ident]=(x,y,w,h)
        return cache[ident]
    def fnt(size,bold=False): return ImageFont.truetype(str(BOLD if bold else REG),size)
    def color(val,default=None): return None if not val or val in ('none','default') else val
    def edge_points(c):
        sx,sy,sw,sh=rect(cells[c.get('source')]);tx,ty,tw,th=rect(cells[c.get('target')])
        s=style_map(c.get('style',''))
        start=(sx+float(s.get('exitX','.5'))*sw,sy+float(s.get('exitY','.5'))*sh)
        end=(tx+float(s.get('entryX','.5'))*tw,ty+float(s.get('entryY','.5'))*th)
        arr=c.find('.//Array[@as="points"]')
        points=[(float(p.get('x')),float(p.get('y'))) for p in arr] if arr is not None else []
        if not points:
            if abs(end[0]-start[0])>=abs(end[1]-start[1]):
                mid=(start[0]+end[0])/2
                points=[(mid,start[1]),(mid,end[1])]
            else:
                mid=(start[1]+end[1])/2
                points=[(start[0],mid),(end[0],mid)]
        return [start]+points+[end]
    for c in cells.values():
        if c.get('edge')!='1': continue
        s=style_map(c.get('style','')); pts=edge_points(c)
        stroke=s.get('strokeColor','#738fa8');wd=int(s.get('strokeWidth','2'))
        d.line(pts,fill=stroke,width=wd,joint='curve')
        x1,y1=pts[-2];x2,y2=pts[-1]
        if abs(x2-x1)>abs(y2-y1):
            v=-1 if x2>x1 else 1
            tri=[(x2,y2),(x2+v*12,y2-7),(x2+v*12,y2+7)]
        else:
            v=-1 if y2>y1 else 1
            tri=[(x2,y2),(x2-7,y2+v*12),(x2+7,y2+v*12)]
        d.polygon(tri,fill=stroke)
        if c.get('value'):
            mx=(pts[0][0]+pts[-1][0])/2;my=(pts[0][1]+pts[-1][1])/2
            d.text((mx+5,my-30),c.get('value'),font=fnt(17),fill='#203b55')
    # Draw parent table borders, then child headers/rows, then free text.
    vertices=[c for c in cells.values() if c.get('vertex')=='1']
    vertices.sort(key=lambda c: (c.get('parent') not in ('1',None), c.get('id','')))
    for c in vertices:
        x,y,w,h=rect(c); s=style_map(c.get('style',''))
        fill=color(s.get('fillColor'))
        outline=color(s.get('strokeColor'))
        if fill: d.rectangle((x,y,x+w,y+h),fill=fill)
        if outline: d.rectangle((x,y,x+w,y+h),outline=outline,width=1)
        value=c.get('value','')
        if not value: continue
        size=int(s.get('fontSize','20')); bold=s.get('fontStyle')=='1'
        ft=fnt(size,bold); ink=s.get('fontColor','#203b55')
        lines=value.split('\n')
        # Wrap unusually long table headings while preserving the grain subtitle.
        if len(lines)>1 and s.get('align')=='center':
            if d.textbbox((0,0),lines[0],font=ft)[2]>w-24:
                words=lines[0].split(' · ')
                if len(words)==2: lines=[words[0],words[1]]+lines[1:]
                else:
                    while size>16 and d.textbbox((0,0),lines[0],font=fnt(size,bold))[2]>w-24: size-=1
                    ft=fnt(size,bold)
        line_h=size+5
        total=len(lines)*line_h
        yy=y+(h-total)/2
        for line in lines:
            if s.get('align')=='center':
                tw=d.textbbox((0,0),line,font=ft)[2]
                xx=x+(w-tw)/2
            else: xx=x+float(s.get('spacingLeft','0'))
            d.text((xx,yy),line,font=ft,fill=ink)
            yy+=line_h
    out=DIR/(stem+'.png');im.save(out)
    print(out)

if __name__=='__main__':
    draw_file('core_history_schema')
    draw_file('history_data_flow')
