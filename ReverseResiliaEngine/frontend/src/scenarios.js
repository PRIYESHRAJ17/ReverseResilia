let database
function openDatabase(){
  if (!database) database = new Promise((resolve,reject)=>{
    const request = indexedDB.open('ReverseResiliaEngine-scenarios',1)
    request.onupgradeneeded=()=>request.result.createObjectStore('cities')
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>{database=undefined;reject(request.error)}
  })
  return database
}

export async function readScenario(city){
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    const request=db.transaction('cities').objectStore('cities').get(city)
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
  })
}

export async function writeScenario(city,scenario){
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('cities','readwrite')
    tx.objectStore('cities').put(scenario,city)
    tx.oncomplete=resolve
    tx.onabort=()=>reject(tx.error)
  })
}
