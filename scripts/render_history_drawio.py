"""Create editable draw.io diagrams using the original core_model.drawio visual language."""
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'diagrams'
OUT.mkdir(parents=True, exist_ok=True)
INK = '#203b55'
LINE = '#738fa8'
PALETTE = {'blue':'#e8f0fc','mint':'#e5f3ef','lilac':'#eee9f8','cream':'#fff2d7'}

def cell(parent, ident, value, style, x, y, w, h, owner='1'):
    node = ET.SubElement(parent,'mxCell',{'id':ident,'value':value,'style':style,'vertex':'1','parent':owner})
    ET.SubElement(node,'mxGeometry',{'x':str(x),'y':str(y),'width':str(w),'height':str(h),'as':'geometry'})
    return node

def edge(parent, ident, source, target, exit_xy, entry_xy, color=LINE, points=None, value=''):
    style=(f'edgeStyle=segmentEdgeStyle;html=0;rounded=0;endArrow=block;endFill=1;'
           f'strokeColor={color};strokeWidth=2;exitX={exit_xy[0]};exitY={exit_xy[1]};'
           f'entryX={entry_xy[0]};entryY={entry_xy[1]};')
    node=ET.SubElement(parent,'mxCell',{'id':ident,'value':value,'source':source,'target':target,
                                      'edge':'1','parent':'1','style':style})
    geometry=ET.SubElement(node,'mxGeometry',{'relative':'1','as':'geometry'})
    if points:
        arr=ET.SubElement(geometry,'Array',{'as':'points'})
        for x,y in points: ET.SubElement(arr,'mxPoint',{'x':str(x),'y':str(y)})

def diagram(name, ident, width, height):
    mx=ET.Element('mxfile',{'host':'app.diagrams.net','type':'device'})
    dia=ET.SubElement(mx,'diagram',{'id':ident,'name':name})
    graph=ET.SubElement(dia,'mxGraphModel',{'grid':'1','gridSize':'10','page':'1',
                                         'pageWidth':str(width),'pageHeight':str(height),
                                         'background':'#ffffff'})
    root=ET.SubElement(graph,'root')
    ET.SubElement(root,'mxCell',{'id':'0'})
    ET.SubElement(root,'mxCell',{'id':'1','parent':'0'})
    return mx,root

def text(root, ident, value, x,y,w,h,size=20,bold=False,color=INK,align='left'):
    style=(f'text;html=0;align={align};verticalAlign=middle;fontFamily=Segoe UI;'
           f'fontSize={size};fontStyle={1 if bold else 0};fontColor={color};whiteSpace=wrap;')
    cell(root,ident,value,style,x,y,w,h)

def table(root, ident, title, grain, rows, x,y,w=530, header_color='blue', row_h=36):
    header_h=76; height=header_h+len(rows)*row_h
    cell(root,ident,'','fillColor=none;strokeColor=#d3dfeb;strokeWidth=1;',x,y,w,height)
    cell(root,ident+'_header',title+'\n'+grain,
         f'whiteSpace=wrap;html=0;align=center;verticalAlign=middle;fillColor={PALETTE[header_color]};'
         f'strokeColor=#d3dfeb;fontColor={INK};fontFamily=Segoe UI;fontSize=20;fontStyle=1;',
         0,0,w,header_h,ident)
    for i,row in enumerate(rows):
        fill='#f3f7fa' if i%2==0 else '#ffffff'
        cell(root,f'{ident}_row{i}',row,
             f'whiteSpace=wrap;html=0;align=left;verticalAlign=middle;spacingLeft=14;'
             f'fillColor={fill};strokeColor=none;fontColor={INK};fontFamily=Segoe UI;fontSize=19;',
             0,header_h+i*row_h,w,row_h,ident)
    return height

def original_rows(table_id):
    src=ET.parse(ROOT/'docs'/'core_model.drawio').getroot()
    nodes=src.findall('.//mxCell')
    return [n.attrib['value'] for n in nodes if n.attrib.get('parent')==table_id and '_row' in n.attrib.get('id','')]

def write(mx,path):
    ET.indent(mx,space='  ')
    ET.ElementTree(mx).write(path,encoding='utf-8',xml_declaration=True)
    ET.parse(path)
    print(path)

def core():
    mx,r=diagram('Core: история и снимки','core-history',2920,1920)
    text(r,'title','Модель маркетплейса · схема core с историей',40,24,2400,60,38,True)
    text(r,'subtitle','Один заказ, одна товарная единица и версии категории хранятся отдельно; снимки защищают прошлые отчёты.',40,94,2700,42,21)
    # Thin orthogonal relationships are deliberately behind the editable tables.
    links=[
      ('customers','orders',(1,.35),(0,.35),LINE,None,'1 : 1'),
      ('orders','order_items',(1,.35),(0,.35),LINE,None,'1 : 0..N'),
      ('products','order_items',(0,.42),(1,.42),LINE,None,'1 : 0..N'),
      ('orders','order_payments',(.30,1),(.5,0),LINE,[(865,810),(325,810)],''),
      ('orders','order_reviews',(.65,1),(.5,0),LINE,[(1070,840),(935,840)],''),
      ('orders','order_address_snapshot',(.85,1),(.5,0),'#5b9a89',[(1180,790),(1545,790)],'1 : 1'),
      ('order_items','order_item_category_snapshot',(.75,1),(.5,0),'#8d78b2',[(1740,820),(2155,820)],'1 : 1'),
      ('sellers','order_items',(.5,0),(.38,1),LINE,[(380,1180),(1450,1180)],''),
      ('categories','products',(.5,0),(.62,1),LINE,[(940,1570),(2640,1570)],''),
      ('seller_product_category_history','sellers',(0,.68),(1,.68),'#8d78b2',None,''),
      ('seller_product_category_history','products',(1,.32),(.45,1),'#8d78b2',[(2790,1450),(2790,800)],''),
    ]
    for i,(s,t,ex,en,c,pts,v) in enumerate(links): edge(r,f'edge{i}',s,t,ex,en,c,pts,v)
    layout={
      'customers':(40,190,'lilac','core.customers · покупатель в оформлении','1 строка = 1 customer_id'),
      'orders':(650,190,'blue','core.orders · заказы','1 строка = 1 заказ'),
      'order_items':(1260,190,'mint','core.order_items · позиции заказа','1 строка = 1 товарная единица'),
      'products':(1870,190,'mint','core.products · карточки товаров','1 строка = 1 product_id'),
      'order_payments':(40,900,'blue','core.order_payments · оплаты','1 строка = 1 запись оплаты'),
      'order_reviews':(650,900,'blue','core.order_reviews · отзывы','1 строка = 1 пара review_id + order_id'),
      'order_address_snapshot':(1260,900,'mint','core.order_address_snapshot · адрес заказа','1 строка = 1 заказ'),
      'order_item_category_snapshot':(1870,900,'lilac','core.order_item_category_snapshot','1 строка = 1 позиция заказа'),
      'sellers':(40,1420,'lilac','core.sellers · продавцы','1 строка = 1 seller_id'),
      'categories':(650,1420,'cream','core.categories · категории','1 строка = 1 код категории'),
      'seller_product_category_history':(1260,1420,'lilac','core.seller_product_category_history','1 строка = 1 версия категории'),
    }
    added={
      'order_address_snapshot':['PK FK order_id : text','zip_code_prefix : text ?','city : text ?','state : text ?'],
      'order_item_category_snapshot':['PK FK order_id : text','PK FK order_item_id : integer','FK category_name : text ?'],
      'seller_product_category_history':['PK FK seller_id : text','PK FK product_id : text','PK valid_from : timestamp','valid_to : timestamp ?','FK category_name : text ?','baseline_inferred : boolean'],
    }
    for ident,(x,y,color,title,grain) in layout.items():
        table(r,ident,title,grain,added.get(ident) or original_rows(ident),x,y,530,color)
    text(r,'legend','PK — первичный ключ; FK — внешний ключ; UK — уникальное поле; ? — допустим NULL. Поля составного PK читаются вместе.',40,1790,2750,34,19)
    text(r,'note','Начальная категория из CSV помечена baseline_inferred: более ранние смены категории в исходных данных отсутствуют.',40,1830,2750,34,19,color='#8a6636')
    write(mx,OUT/'core_history_schema.drawio')

def flow():
    mx,r=diagram('Raw → core → mart','history-flow',2500,1280)
    text(r,'title','Модель маркетплейса · от raw до mart',40,25,2200,58,38,True)
    text(r,'subtitle','Снимки создаются при оформлении заказа и продаже единицы товара; старые отчёты не переписываются.',40,94,2350,38,21)
    for i,(s,t) in enumerate([('raw','core'),('core','history'),('history','mart')]):
        edge(r,f'flow{i}',s,t,(1,.5),(0,.5),LINE,None,'')
    table(r,'raw','raw · исходные данные','8 CSV, значения сохраняются как есть',[
      'orders · customers','order_items · products','sellers · payments · reviews','все поля исходно text'],40,260,530,'blue',46)
    table(r,'core','core · факты','ключи, типы и связи',[
      'orders · order_items','customers · products · sellers','categories · payments · reviews','проверка целостности'],650,260,530,'mint',46)
    table(r,'history','core · история','состояние на момент события',[
      'order_address_snapshot','order_item_category_snapshot','seller_product_category_history','старые снимки не перезаписываются'],1260,260,530,'lilac',46)
    table(r,'mart','mart · аналитика','VIEW поверх core',[
      'order_metrics · delivered_items','monthly_sales · seller_monthly_sales','category_monthly_sales · KPI','единые формулы для дашборда'],1870,260,530,'cream',46)
    table(r,'move','Покупатель переехал','что увидит отчёт по доставке',[
      'Заказ 1: штат SP → снимок SP','Позже новый адрес: штат RJ','Заказ 2: штат RJ → снимок RJ','Старый заказ остаётся в SP'],240,760,900,'mint',54)
    table(r,'reclass','Продавец сменил категорию','что увидит отчёт по выручке',[
      'Продажа 1: «Книги» → снимок «Книги»','Новая версия: «Электроника»','Продажа 2: снимок «Электроника»','Старая выручка остаётся в «Книгах»'],1320,760,900,'lilac',54)
    text(r,'footer','Граница данных: CSV даёт только первое известное состояние, прежние смены категории восстановить нельзя.',40,1180,2400,42,20,color='#8a6636')
    write(mx,OUT/'history_data_flow.drawio')

if __name__=='__main__':
    core(); flow()
