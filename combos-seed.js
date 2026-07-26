// 套餐組合商品:本身不是「商品」表裡的獨立庫存項目,是幾個商品組合賣的套餐。
// components 填好之後(每項 {code, qty}),同步程式才知道賣一組要扣哪些商品的庫存。
// 目前 components 還是空的,等實際內容確認後再補上。
export const COMBOS = [
  { code: "1+2面膜", name: "水潤去角質滋養面膜套裝(200ml)", price: 3178, components: [] },
  { code: "10件組", name: "10件組", price: 16229, components: [] },
  { code: "4+5+6", name: "維生素C三件套裝(1set)", price: 4398, components: [] },
];
