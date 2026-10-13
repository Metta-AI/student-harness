// Shared by web clients and server projections. Never accept a URL from
// notification content; construct only these authenticated, first-party routes.
function findingHref(id){
 if(typeof id!=='string'||!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id))throw Error('Invalid finding ID');
 return `/updates/${id}`;
}
function findingDestination(value){
 try{return value?.kind==='finding'?findingHref(value.id):'/updates';}catch{return '/updates';}
}
module.exports={findingHref,findingDestination};
