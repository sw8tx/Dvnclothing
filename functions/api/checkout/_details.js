import { CheckoutError } from './_lib.js';

// Customer-entered delivery details are separate from payment-provider proof.
// Never accept card data, client totals or identity/role fields here.
export function deliveryDetails(value) {
  const keys=['firstName','lastName','line1','line2','postalCode','city','country','phone'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new CheckoutError('invalid_delivery');
  const result={};
  for(const key of keys){
    const raw=value[key]??'';
    if(typeof raw!=='string'||raw.length>200||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(raw))throw new CheckoutError('invalid_delivery');
    result[key]=raw.trim();
  }
  if(['firstName','lastName','line1','city'].some(k=>!result[k])||result.firstName.length>70||result.lastName.length>70
    ||result.line1.length>150||result.line2.length>150||result.city.length>100||result.country!=='DE'
    ||!/^\d{5}$/.test(result.postalCode))throw new CheckoutError('invalid_delivery');
  if(result.phone){
    if(!/^\+?[0-9 ().\/-]{6,30}$/.test(result.phone))throw new CheckoutError('invalid_phone');
    result.phone=result.phone.replace(/[ ().\/-]/g,'');
    if(!/^\+?\d{6,15}$/.test(result.phone))throw new CheckoutError('invalid_phone');
  }
  return result;
}
export function storedDelivery(order){return order.checkout_details_json?deliveryDetails(JSON.parse(order.checkout_details_json)):null;}
export function providerShipping(d,method){
  const name=d.firstName+' '+d.lastName;
  return method==='paypal'?{name:{full_name:name},address:{address_line_1:d.line1,address_line_2:d.line2,
    admin_area_2:d.city,postal_code:d.postalCode,country_code:d.country}}:
    {name,address:{line1:d.line1,line2:d.line2,city:d.city,postal_code:d.postalCode,country:d.country}};
}
