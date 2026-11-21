// Shared, deterministic cart rules. The payment server validates independently.
export function normalizeCart(input, products) {
  if(!Array.isArray(input))return [];
  const catalog=new Map(products.map(p=>[p.id,p]));
  const result=new Map();let total=0;
  for(const line of input.slice(0,30)){
    if(!line || !catalog.has(line.productId))continue;
    const p=catalog.get(line.productId);
    if(!p.sizes.includes(line.size)||!Number.isInteger(line.quantity)||line.quantity<1)continue;
    const amount=Math.min(line.quantity,99-total);if(!amount)break;
    const key=line.productId+':'+line.size;
    const old=result.get(key);
    result.set(key,{productId:line.productId,size:line.size,quantity:(old?.quantity||0)+amount});total+=amount;
  }
  return [...result.values()];
}
export function cartSubtotal(lines,products){
  const catalog=new Map(products.map(p=>[p.id,p]));
  return normalizeCart(lines,products).reduce((sum,line)=>sum+catalog.get(line.productId).priceCents*line.quantity,0);
}
export function cartStorageKey(user){
  return typeof user?.id==='string'&&user.id ? 'dvn-first-drop-bag-v1:'+encodeURIComponent(user.id) : null;
}
