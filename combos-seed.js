// 套餐組合商品:本身不是「商品」表裡的獨立庫存項目,是幾個商品組合賣的套餐,
// 賣的當下才展開扣 components 裡每個商品的庫存(見 index.html 的 ASSEMBLY_KITS 說明,
// 10件組已經改成「先組裝成有自己庫存的成品」,不再放在這裡)。
export const COMBOS = [
  { code: "1+2面膜", name: "水潤去角質滋養面膜套裝(200ml)", price: 3178, components: [
    { code: "1號面膜", qty: 1 },
    { code: "2號面膜", qty: 1 },
  ] },
  { code: "4+5+6", name: "維生素C三件套裝(1set)", price: 4398, components: [
    { code: "4號", qty: 1 },
    { code: "5號", qty: 1 },
    { code: "6號-1", qty: 1 },
  ] },
];
