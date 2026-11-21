const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
let normalizeCart,cartSubtotal,cartStorageKey;
const products=JSON.parse(readFileSync(require.resolve('../catalog.json'),'utf8')).products;
before(async()=>({normalizeCart,cartSubtotal,cartStorageKey}=await import('../store-cart.js')));
test('new catalog cart uses exact integer prices and combines the same size only',()=>{
 const raw=[{productId:'blue-mirage-black',size:'S',quantity:2,priceCents:1},{productId:'blue-mirage-black',size:'S',quantity:1},{productId:'define-your-vision',size:'M',quantity:1}];
 assert.deepEqual(normalizeCart(raw,products),[{productId:'blue-mirage-black',size:'S',quantity:3},{productId:'define-your-vision',size:'M',quantity:1}]);
 assert.equal(cartSubtotal(raw,products),8200);
});
test('new cart rejects removed products, unavailable sizes and invalid quantities',()=>{
 const base={productId:'blue-mirage-black',size:'S',quantity:1};
 assert.deepEqual(normalizeCart([{...base,productId:'black'},{...base,size:'XL'},{...base,quantity:'2'},{...base,quantity:-1},{...base,quantity:1.5},null],products),[]);
});
test('new cart total cannot exceed the same 99-item ceiling as the payment server',()=>{
 const lines=normalizeCart([{productId:'blue-mirage-black',size:'S',quantity:80},{productId:'purple-sunshine',size:'M',quantity:90}],products);
 assert.equal(lines.reduce((s,l)=>s+l.quantity,0),99);
});
test('guest selections have no account storage key and different accounts stay separate',()=>{
 assert.equal(cartStorageKey(null),null);assert.equal(cartStorageKey({email:'a@example.com'}),null);
 assert.notEqual(cartStorageKey({id:'a'}),cartStorageKey({id:'b'}));
 assert.equal(cartStorageKey({id:'linked/canonical'}),'dvn-first-drop-bag-v1:linked%2Fcanonical');
});
