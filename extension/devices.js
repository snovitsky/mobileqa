// width/height describe the full display rectangle; panel subtracts decorative status chrome from the website viewport.
export const DEVICES = [
 {id:'iphone11',diagonalInches:6.06,name:'iPhone 11',width:414,height:896,dpr:2,platform:'iPhone'},
 {id:'redminote13',diagonalInches:6.67,name:'Xiaomi Redmi Note 13',width:393,height:873,dpr:2.75,platform:'Android'},
 {id:'galaxya12',diagonalInches:6.5,name:'Samsung Galaxy A12',width:360,height:800,dpr:2,platform:'Android'},
 {id:'ipad11',diagonalInches:10.86,name:'Apple iPad 11 (2025)',width:820,height:1180,dpr:2,platform:'iPad'},
 {id:'iphone17',diagonalInches:6.27,name:'iPhone 17',width:402,height:874,dpr:3,platform:'iPhone',rank:1},
 {id:'iphone17max',diagonalInches:6.86,name:'iPhone 17 Pro Max',width:440,height:956,dpr:3,platform:'iPhone',rank:2},
 {id:'iphone17pro',diagonalInches:6.27,name:'iPhone 17 Pro',width:402,height:874,dpr:3,platform:'iPhone',rank:3},
 {id:'galaxys24',diagonalInches:6.2,name:'Samsung Galaxy S24',width:360,height:780,dpr:3,platform:'Android'},
 {id:'pixel7',diagonalInches:6.3,name:'Google Pixel 7',width:412,height:915,dpr:2.625,platform:'Android'},
 {id:'iphonese',diagonalInches:4.7,name:'iPhone SE (2022)',width:375,height:667,dpr:2,platform:'iPhone'}
];
export function normalizeURL(value) {
 const raw=value.trim();
 if(!raw) throw new Error('Введите адрес сайта.');
 const url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw)?raw:'https://'+raw);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('Нужен адрес http:// или https:// без пароля.');
 return url.href;
}
