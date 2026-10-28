"""Render the current core schema and historical data flow as readable PNGs."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'diagrams'
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path('C:/Windows/Fonts/arial.ttf')
BOLD = Path('C:/Windows/Fonts/arialbd.ttf')

def font(size, bold=False):
    return ImageFont.truetype(str(BOLD if bold else FONT), size)

BG = '#f7f9fc'
INK = '#17233a'
MUTED = '#56647a'
BLUE = '#2878cf'
GREEN = '#147d6b'
PURPLE = '#7954b8'
ORANGE = '#c47821'

def card(d, box, title, lines, accent, subtitle=None):
    x,y,w,h = box
    d.rounded_rectangle((x+5,y+7,x+w+5,y+h+7), radius=22, fill='#dce4ef')
    d.rounded_rectangle((x,y,x+w,y+h), radius=22, fill='white', outline='#d4deea', width=2)
    d.rounded_rectangle((x,y,x+w,y+54), radius=22, fill=accent)
    d.rectangle((x,y+31,x+w,y+54), fill=accent)
    title_size=27
    while d.textbbox((0,0), title, font=font(title_size,True))[2]>w-40:
        title_size-=1
    d.text((x+20,y+12), title, font=font(title_size,True), fill='white')
    yy=y+69
    if subtitle:
        d.text((x+20,yy), subtitle, font=font(19), fill=MUTED)
        yy+=33
    for line in lines:
        d.text((x+20,yy), line, font=font(20), fill=INK)
        yy+=31

def arrow(d, points, color='#8394aa', width=5):
    d.line(points, fill=color, width=width, joint='curve')
    x1,y1=points[-2]; x2,y2=points[-1]
    if abs(x2-x1)>=abs(y2-y1):
        a=-1 if x2>x1 else 1
        d.polygon([(x2,y2),(x2+a*15,y2-9),(x2+a*15,y2+9)],fill=color)
    else:
        a=-1 if y2>y1 else 1
        d.polygon([(x2,y2),(x2-9,y2+a*15),(x2+9,y2+a*15)],fill=color)

def label(d, xy, value, color=MUTED):
    d.text(xy,value,font=font(18,True),fill=color)

def schema():
    im=Image.new('RGB',(2700,1630),BG); d=ImageDraw.Draw(im)
    d.text((65,44),'Capibara · схема core после вброса',font=font(46,True),fill=INK)
    d.text((67,106),'PK — первичный ключ · FK — ссылка · цветные таблицы фиксируют историю',font=font(24),fill=MUTED)
    boxes={
      'customers':(65,210,395,210),'orders':(565,210,405,300),
      'items':(1075,210,430,330),'products':(1600,210,430,265),
      'categories':(2130,210,495,175),
      'address':(565,650,405,230),'itemcat':(1075,670,430,215),
      'history':(1600,640,505,330),'sellers':(2205,645,420,185),
      'payments':(565,1110,405,195),'reviews':(1075,1110,430,200),
    }
    # References point toward the parent table.
    arrow(d,[(565,315),(460,315)],BLUE)
    arrow(d,[(1075,350),(970,350)],BLUE)
    arrow(d,[(1600,350),(1505,350)],BLUE)
    arrow(d,[(2130,290),(2030,290)],BLUE)
    arrow(d,[(1505,500),(2150,500),(2150,730),(2205,730)],BLUE)
    arrow(d,[(767,650),(767,510)],GREEN); label(d,(790,573),'order_id · 1:1',GREEN)
    arrow(d,[(1290,670),(1290,540)],PURPLE); label(d,(1310,595),'позиция · 1:1',PURPLE)
    arrow(d,[(1850,640),(1850,475)],PURPLE); label(d,(1870,546),'product_id',PURPLE)
    arrow(d,[(2105,770),(2205,770)],PURPLE)
    arrow(d,[(565,1200),(520,1200),(520,475),(565,475)],BLUE)
    arrow(d,[(1075,1200),(1025,1200),(1025,550),(970,550),(970,470)],BLUE)
    card(d,boxes['customers'],'core.customers',[
      'PK customer_id','customer_unique_id','адрес из выгрузки оформления'],BLUE,'Одна запись оформления')
    card(d,boxes['orders'],'core.orders',[
      'PK order_id','FK customer_id','order_status','order_purchase_at','даты оплаты и доставки'],BLUE,'Один заказ')
    card(d,boxes['items'],'core.order_items',[
      'PK order_id + order_item_id','FK product_id · FK seller_id','price · freight_value','shipping_limit_at'],BLUE,'Одна проданная единица')
    card(d,boxes['products'],'core.products',[
      'PK product_id','FK category_name','характеристики товара'],BLUE,'Текущая карточка')
    card(d,boxes['categories'],'core.categories',[
      'PK category_name','category_name_english'],BLUE)
    card(d,boxes['address'],'core.order_address_snapshot',[
      'PK/FK order_id','zip_code_prefix · city · state','сохраняется при оформлении'],GREEN,'Адрес именно этого заказа')
    card(d,boxes['itemcat'],'core.order_item_category_snapshot',[
      'PK/FK order_id + order_item_id','FK category_name','сохраняется при продаже'],PURPLE)
    card(d,boxes['history'],'core.seller_product_category_history',[
      'PK seller_id + product_id + valid_from','valid_to · FK category_name','baseline_inferred','версии [valid_from, valid_to)'],PURPLE,'Категория предложения во времени')
    card(d,boxes['sellers'],'core.sellers',[
      'PK seller_id','city · state'],BLUE)
    card(d,boxes['payments'],'core.order_payments',[
      'PK order_id + payment_sequential','payment_type · payment_value'],BLUE)
    card(d,boxes['reviews'],'core.order_reviews',[
      'PK review_id + order_id','review_score · даты отзыва'],BLUE)
    d.rounded_rectangle((1600,1090,2625,1365),radius=22,fill='#e8f4f0')
    d.text((1630,1120),'Главное правило',font=font(30,True),fill=GREEN)
    for j,t in enumerate(['Смена категории → новая версия истории.','Переезд → новый адрес следующего заказа.','Снимки старых заказов и продаж остаются прежними.']):
        d.text((1630,1177+j*49),t,font=font(24),fill=INK)
    d.text((67,1510),'Источник: model/01_schema.sql · данные Olist не содержат прошлых событий смены категории',font=font(23),fill=MUTED)
    path=OUT/'core_history_schema.png'; im.save(path); return path

def flow():
    im=Image.new('RGB',(2500,1320),BG); d=ImageDraw.Draw(im)
    d.text((65,45),'Как работает историчность: raw → core → mart',font=font(46,True),fill=INK)
    d.text((67,108),'Схема потока для защиты · срезы фиксируются при первом приёме заказа',font=font(24),fill=MUTED)
    arrow(d,[(530,435),(655,435)],BLUE,7)
    arrow(d,[(1180,435),(1315,435)],GREEN,7)
    arrow(d,[(1840,435),(1975,435)],PURPLE,7)
    card(d,(65,270,465,320),'raw',[
      'orders · customers','order_items · products','sellers · payments · reviews','8 исходных файлов, без правок'],BLUE,'Исходная выгрузка')
    card(d,(655,270,525,320),'core · факты',[
      'orders · order_items','customers · products · sellers','categories · payments · reviews','ключи, типы, проверки'],BLUE,'Нормализованные данные')
    card(d,(1315,270,525,320),'core · история',[
      'адрес на момент заказа','категория каждой позиции','версии категории продавца','старые снимки неизменны'],GREEN,'Исторический смысл')
    card(d,(1975,270,460,320),'mart',[
      'order_metrics','delivered_items','месяц · продавец · категория','дашборд и SQL-ответы'],PURPLE,'Единые формулы')
    d.rounded_rectangle((100,730,1190,1100),radius=26,fill='#e7f3ed')
    d.text((140,765),'Покупатель переехал',font=font(33,True),fill=GREEN)
    d.text((140,830),'Заказ 1: штат SP → снимок SP',font=font(28),fill=INK)
    d.text((140,884),'При следующем оформлении: штат RJ',font=font(28),fill=INK)
    d.text((140,938),'Заказ 2: штат RJ → снимок RJ',font=font(28),fill=INK)
    d.text((140,1011),'Отчёт по заказу 1 остаётся в SP.',font=font(27,True),fill=GREEN)
    d.rounded_rectangle((1310,730,2400,1100),radius=26,fill='#f0eafb')
    d.text((1350,765),'Продавец сменил категорию',font=font(33,True),fill=PURPLE)
    d.text((1350,830),'Продажа 1: «Книги» → снимок «Книги»',font=font(28),fill=INK)
    d.text((1350,884),'Новая версия: «Электроника»',font=font(28),fill=INK)
    d.text((1350,938),'Продажа 2: снимок «Электроника»',font=font(28),fill=INK)
    d.text((1350,1011),'Старая выручка остаётся в «Книгах».',font=font(27,True),fill=PURPLE)
    d.text((70,1210),'Важно: исходные CSV дают только первое известное состояние; прежние смены категории восстановить нельзя.',font=font(25),fill=ORANGE)
    path=OUT/'history_data_flow.png'; im.save(path); return path

if __name__=='__main__':
    print(schema())
    print(flow())
