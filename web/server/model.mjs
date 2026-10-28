// Logical contract from the team's core model (4bc3b28), not inferred from demo records.
const field = (name, type, role = '', nullable = false) => ({ name, type, role, nullable });
export const entities = [
  { id: 'customers', raw: 'customers', title: 'Покупатели', grain: 'ID покупателя в конкретном оформлении', key: 'customer_id',
    note: 'customer_unique_id связывает оформления одного человека. Он повторяется; customer_id не заменяет ID человека.',
    fields: [field('customer_id', 'text', 'PK'), field('customer_unique_id', 'text'), field('zip_code_prefix', 'text', '', true), field('city', 'text', '', true), field('state', 'text', '', true)] },
  { id: 'orders', raw: 'orders', title: 'Заказы', grain: 'Один заказ, независимо от наличия позиций, оплаты и отзыва', key: 'order_id',
    note: 'Статус и даты — разные факты. Статус delivered может иметь пропуск даты вручения.',
    fields: [field('order_id', 'text', 'PK'), field('customer_id', 'text', 'FK · UNIQUE'), field('order_status', 'text'), field('order_purchase_at', 'timestamp'), field('order_approved_at', 'timestamp', '', true), field('delivered_carrier_at', 'timestamp', '', true), field('delivered_customer_at', 'timestamp', '', true), field('estimated_delivery_date', 'date', '', true)] },
  { id: 'order_items', raw: 'order_items', title: 'Позиции', grain: 'Одна физическая единица товара одного продавца в заказе', key: 'order_id + order_item_id',
    note: 'Две единицы одинакового товара остаются двумя строками. Платежи агрегируются до соединения с позициями.',
    fields: [field('order_id', 'text', 'PK · FK'), field('order_item_id', 'integer', 'PK'), field('product_id', 'text', 'FK'), field('seller_id', 'text', 'FK'), field('shipping_limit_at', 'timestamp'), field('price', 'numeric(12,2)'), field('freight_value', 'numeric(12,2)')] },
  { id: 'order_payments', raw: 'order_payments', title: 'Платежи', grain: 'Одна запись оплаты заказа', key: 'order_id + payment_sequential',
    note: 'В одном заказе несколько способов оплаты. payment_installments — число частей, не множитель payment_value.',
    fields: [field('order_id', 'text', 'PK · FK'), field('payment_sequential', 'integer', 'PK'), field('payment_type', 'text'), field('payment_installments', 'integer'), field('payment_value', 'numeric(12,2)')] },
  { id: 'order_reviews', raw: 'order_reviews', title: 'Отзывы', grain: 'Отзыв по паре идентификатора отзыва и заказа', key: 'review_id + order_id',
    note: 'review_id повторяется между заказами, поэтому не является самостоятельным ключом. Время создания сохраняется.',
    fields: [field('review_id', 'text', 'PK'), field('order_id', 'text', 'PK · FK'), field('review_score', 'smallint'), field('comment_title', 'text', '', true), field('comment_message', 'text', '', true), field('review_created_at', 'timestamp'), field('review_answered_at', 'timestamp')] },
  { id: 'products', raw: 'products', title: 'Товары', grain: 'Одна карточка товара', key: 'product_id',
    note: 'Пропущенная категория остаётся NULL. Исправлены имена колонок lenght, значения raw не меняются.',
    fields: [field('product_id', 'text', 'PK'), field('category_name', 'text', 'FK', true), ...['name_length', 'description_length', 'photos_qty'].map(n => field(n, 'integer', '', true)), ...['weight_g', 'length_cm', 'height_cm', 'width_cm'].map(n => field(n, 'numeric(12,2)', '', true))] },
  { id: 'sellers', raw: 'sellers', title: 'Продавцы', grain: 'Один продавец', key: 'seller_id',
    note: 'Продавцу принадлежит только выручка его позиций. Почтовый префикс хранится текстом.',
    fields: [field('seller_id', 'text', 'PK'), field('zip_code_prefix', 'text', '', true), field('city', 'text', '', true), field('state', 'text', '', true)] },
  { id: 'categories', raw: 'product_category_translation', title: 'Категории', grain: 'Один исходный португальский код категории', key: 'category_name',
    note: 'Справочник объединяет коды из переводов и товаров. Нет перевода — остаётся исходный код; фиктивного ID для NULL нет.',
    fields: [field('category_name', 'text', 'PK'), field('category_name_english', 'text', '', true)] },
];
export const relations = [
  { from: 'orders', to: 'customers', label: 'customer_id', cardinality: '1 : 1', note: 'Один ID оформления соответствует одному заказу в текущей модели.' },
  { from: 'order_items', to: 'orders', label: 'order_id', cardinality: 'N : 1' },
  { from: 'order_items', to: 'products', label: 'product_id', cardinality: 'N : 1' },
  { from: 'order_items', to: 'sellers', label: 'seller_id', cardinality: 'N : 1' },
  { from: 'order_payments', to: 'orders', label: 'order_id', cardinality: 'N : 1' },
  { from: 'order_reviews', to: 'orders', label: 'order_id', cardinality: 'N : 1' },
  { from: 'products', to: 'categories', label: 'category_name', cardinality: 'N : 0..1' },
];
// Logical grains and lineage, not foreign-key constraints on SQL views.
export const martEntities = [
  {id:'order_metrics',title:'Показатели заказов',grain:'Один заказ, все статусы',key:'order_id',
   note:'Стоимость товаров, доставка и состав заказа. Заказы без позиций сохраняются.',inputs:['core.orders','core.customers','core.order_items']},
  {id:'delivered_items',title:'Доставленные товары',grain:'Одна единица товара в доставленном заказе',key:'order_id + order_item_id',
   note:'Выручка без доставки, продавец, категория и штат покупателя.',inputs:['core.order_items','core.orders','core.customers','core.products','core.sellers','core.categories']},
  {id:'monthly_sales',title:'Продажи по месяцам',grain:'Один календарный месяц',key:'month',
   note:'Месяцы без продаж сохранены. Средний чек пустого месяца не определён.',inputs:['mart.order_metrics']},
  {id:'seller_monthly_sales',title:'Продажи продавцов',grain:'Один продавец за месяц',key:'month + seller_id',
   note:'Выручка относится только к товарам данного продавца.',inputs:['mart.delivered_items']},
  {id:'category_monthly_sales',title:'Продажи по категориям',grain:'Одна категория за месяц, включая неизвестную',key:'month + category_code (NULL — без категории)',
   note:'Неизвестная категория включена в общую выручку.',inputs:['mart.delivered_items']},
  {id:'customer_purchases',title:'История покупок',grain:'Один уникальный покупатель за всю историю',key:'customer_unique_id',
   note:'Все статусы заказов; даты первого и последнего оформления.',inputs:['mart.order_metrics']},
  {id:'repeat_customers',title:'Повторные покупки',grain:'Один общий итог за всю историю',key:'Одна итоговая строка',
   note:'Доля покупателей с двумя и более заказами. Для периода API пересчитывает показатель по order_metrics.',inputs:['mart.customer_purchases']},
  {id:'sales_kpis',title:'Показатели продаж',grain:'Один общий итог доставленных заказов с товарами',key:'Одна итоговая строка',
   note:'Выручка, средний чек, среднее количество строк и единиц в заказе.',inputs:['mart.order_metrics']},
];
export function modelPayload(data, source, marts = null, coreStats = null) {

  const counts = coreStats?.counts ?? (data ? {
    orders: data.orders.length, customers: data.sourceCounts?.customers ?? new Set(data.orders.map(o => o.customerId ?? o.id)).size,
    order_items: data.orders.reduce((n, o) => n + o.items.length, 0),
    order_payments: data.orders.reduce((n, o) => n + (o.payments?.length ?? 0), 0),
    order_reviews: data.orders.reduce((n, o) => n + (o.reviews?.length ?? 0), 0),
    products: data.products?.length ?? new Set(data.orders.flatMap(o => o.items.map(i => i.productId))).size,
    sellers: data.sellers.length, categories: data.categories.filter(c => c.id !== null).length,
  } : {});
  return { source, available: !!data || !!coreStats, loadedAt: coreStats?.loadedAt ?? data?.loadedAt ?? null, contract: 'core + mart · PostgreSQL 16',
    martAvailable: marts !== null,
    marts: martEntities.map(e => ({...e,raw:'',fields:marts?.fields[e.id] ?? [],count:marts?.counts[e.id] ?? null})),
    martRelations: martEntities.flatMap(e => e.inputs.map(input => ({from:input,to:`mart.${e.id}`,label:'SQL-зависимость',cardinality:'VIEW'}))),
    entities: entities.map(e => ({ ...e, count: counts[e.id] ?? null })), relations };
}
