// Curated destination coverage, not a ranking. Generic symbols are labelled as fallbacks.
// Each visual family contains 20 destinations. Country fields are ISO 3166-1 alpha-2.
const groups=[
['iberian','Iberian',`Santiago de Compostela|ES|shell
A Coruña|ES|lighthouse
Madrid|ES|museum
Barcelona|ES|building
Seville|ES|arch
Granada|ES|castle
Valencia|ES|market
Bilbao|ES|gallery
San Sebastián|ES|beach
Málaga|ES|palm
Córdoba|ES|columns
Toledo|ES|castle
Salamanca|ES|book
Zaragoza|ES|dome
Lisbon|PT|tram
Porto|PT|bridge
Coimbra|PT|book
Sintra|PT|castle
Faro|PT|sailboat
Funchal|PT|flower`],
['french-benelux','French and Benelux',`Paris|FR|tower
Lyon|FR|dining
Marseille|FR|port
Nice|FR|beach
Bordeaux|FR|wine
Toulouse|FR|bridge
Strasbourg|FR|village
Nantes|FR|river
Lille|FR|building
Avignon|FR|bridge
Montpellier|FR|sun
Dijon|FR|dining
Brussels|BE|market
Bruges|BE|canal
Ghent|BE|castle
Antwerp|BE|port
Amsterdam|NL|canal
Rotterdam|NL|port
Utrecht|NL|clock-tower
Luxembourg|LU|castle`],
['alpine','German and Alpine',`Berlin|DE|arch
Munich|DE|clock-tower
Hamburg|DE|port
Cologne|DE|tower
Frankfurt|DE|skyline
Dresden|DE|dome
Leipzig|DE|music
Heidelberg|DE|castle
Nuremberg|DE|castle
Freiburg|DE|forest
Vienna|AT|music
Salzburg|AT|castle
Innsbruck|AT|mountain
Graz|AT|clock-tower
Linz|AT|river
Zurich|CH|lake
Geneva|CH|fountain
Lucerne|CH|bridge
Bern|CH|clock-tower
Lausanne|CH|lake`],
['central-european','Central European',`Prague|CZ|bridge
Brno|CZ|building
Český Krumlov|CZ|castle
Karlovy Vary|CZ|wellness
Olomouc|CZ|columns
Warsaw|PL|skyline
Kraków|PL|castle
Gdańsk|PL|port
Wrocław|PL|bridge
Poznań|PL|market
Toruń|PL|village
Łódź|PL|gallery
Zakopane|PL|mountain
Bratislava|SK|castle
Košice|SK|tower
Banská Štiavnica|SK|village
Budapest|HU|bridge
Pécs|HU|dome
Eger|HU|wine
Szeged|HU|sun`],
['british-irish','British and Irish',`London|GB|clock-tower
Edinburgh|GB|castle
Glasgow|GB|music
Manchester|GB|music
Liverpool|GB|port
York|GB|tower
Bath|GB|columns
Bristol|GB|bridge
Oxford|GB|book
Cambridge|GB|book
Brighton|GB|beach
Cardiff|GB|castle
Belfast|GB|port
Inverness|GB|river
Dublin|IE|book
Cork|IE|market
Galway|IE|music
Limerick|IE|castle
Kilkenny|IE|castle
Killarney|IE|lake`],
['nordic','Nordic',`Copenhagen|DK|bicycle
Aarhus|DK|gallery
Odense|DK|book
Aalborg|DK|port
Stockholm|SE|island
Gothenburg|SE|tram
Malmö|SE|bridge
Uppsala|SE|book
Visby|SE|castle
Oslo|NO|sailboat
Bergen|NO|village
Trondheim|NO|bridge
Tromsø|NO|mountain
Stavanger|NO|port
Helsinki|FI|dome
Turku|FI|castle
Tampere|FI|lake
Rovaniemi|FI|snowflake
Reykjavík|IS|sunrise
Akureyri|IS|mountain`],
['italian','Italian',`Rome|IT|ruins
Florence|IT|dome
Venice|IT|canal
Milan|IT|tower
Naples|IT|volcano
Turin|IT|museum
Bologna|IT|arch
Verona|IT|theatre
Genoa|IT|port
Pisa|IT|tower
Siena|IT|market
Lucca|IT|bicycle
Perugia|IT|steps
Assisi|IT|village
Ravenna|IT|gallery
Palermo|IT|market
Catania|IT|volcano
Cagliari|IT|beach
Bari|IT|port
Trieste|IT|dining`],
['greek-adriatic','Greek and Adriatic',`Athens|GR|columns
Thessaloniki|GR|tower
Heraklion|GR|ruins
Chania|GR|lighthouse
Rhodes|GR|castle
Corfu|GR|island
Nafplio|GR|castle
Patras|GR|port
Split|HR|columns
Dubrovnik|HR|castle
Zagreb|HR|tram
Zadar|HR|sunrise
Pula|HR|ruins
Rijeka|HR|port
Ljubljana|SI|bridge
Bled|SI|lake
Sarajevo|BA|market
Mostar|BA|bridge
Kotor|ME|mountain
Tirana|AL|building`],
['eastern-european','Eastern European',`Tallinn|EE|castle
Tartu|EE|book
Riga|LV|building
Liepāja|LV|beach
Vilnius|LT|dome
Kaunas|LT|building
Bucharest|RO|building
Brașov|RO|mountain
Sibiu|RO|village
Cluj-Napoca|RO|clock-tower
Timișoara|RO|market
Sofia|BG|dome
Plovdiv|BG|ruins
Varna|BG|beach
Veliko Tarnovo|BG|castle
Belgrade|RS|river
Novi Sad|RS|castle
Skopje|MK|bridge
Ohrid|MK|lake
Chișinău|MD|wine`],
['japanese','Japanese',`Kyoto|JP|pagoda
Tokyo|JP|skyline
Osaka|JP|castle
Nara|JP|temple
Hiroshima|JP|river
Nagasaki|JP|port
Fukuoka|JP|bowl
Sapporo|JP|snowflake
Hakodate|JP|port
Sendai|JP|tree
Kanazawa|JP|garden-gate
Takayama|JP|village
Nagoya|JP|castle
Yokohama|JP|port
Kobe|JP|mountain
Himeji|JP|castle
Kamakura|JP|temple
Nikkō|JP|torii
Matsumoto|JP|castle
Naha|JP|island`],
['korean','Korean',`Seoul|KR|temple
Busan|KR|beach
Incheon|KR|port
Daegu|KR|market
Daejeon|KR|observatory
Gwangju|KR|gallery
Ulsan|KR|port
Suwon|KR|castle
Jeonju|KR|village
Gyeongju|KR|pagoda
Jeju City|KR|volcano
Seogwipo|KR|waterfall
Gangneung|KR|beach
Sokcho|KR|mountain
Andong|KR|village
Chuncheon|KR|lake
Yeosu|KR|sailboat
Mokpo|KR|port
Pohang|KR|sunrise
Tongyeong|KR|island`],
['east-asian','East Asian',`Beijing|CN|temple
Shanghai|CN|skyline
Xi’an|CN|castle
Chengdu|CN|tea
Chongqing|CN|bridge
Hangzhou|CN|lake
Suzhou|CN|garden-gate
Nanjing|CN|castle
Guilin|CN|mountain
Kunming|CN|flower
Lijiang|CN|village
Dali|CN|lake
Guangzhou|CN|tower
Shenzhen|CN|skyline
Xiamen|CN|island
Hong Kong|HK|sailboat
Macau|MO|ruins
Taipei|TW|tower
Tainan|TW|temple
Kaohsiung|TW|port`],
['south-asian','South Asian',`Delhi|IN|arch
Agra|IN|dome
Jaipur|IN|castle
Mumbai|IN|arch
Udaipur|IN|lake
Jodhpur|IN|castle
Varanasi|IN|steps
Kolkata|IN|bridge
Chennai|IN|temple
Bengaluru|IN|garden-gate
Kochi|IN|port
Panaji|IN|palm
Amritsar|IN|temple
Kathmandu|NP|pagoda
Pokhara|NP|mountain
Colombo|LK|port
Kandy|LK|lake
Galle|LK|lighthouse
Dhaka|BD|boat
Thimphu|BT|mountain`],
['mainland-southeast-asian','Mainland Southeast Asian',`Bangkok|TH|temple
Chiang Mai|TH|pagoda
Chiang Rai|TH|temple
Ayutthaya|TH|ruins
Sukhothai|TH|ruins
Phuket|TH|beach
Krabi|TH|island
Hua Hin|TH|beach
Hanoi|VN|lake
Ho Chi Minh City|VN|scooter
Hội An|VN|village
Huế|VN|castle
Da Nang|VN|bridge
Nha Trang|VN|beach
Da Lat|VN|flower
Phnom Penh|KH|temple
Siem Reap|KH|ruins
Luang Prabang|LA|pagoda
Vientiane|LA|arch
Vang Vieng|LA|mountain`],
['maritime-southeast-asian','Maritime Southeast Asian',`Singapore|SG|suitcase
Kuala Lumpur|MY|skyline
George Town|MY|market
Malacca|MY|river
Ipoh|MY|dining
Kota Kinabalu|MY|mountain
Kuching|MY|river
Jakarta|ID|skyline
Yogyakarta|ID|temple
Bandung|ID|mountain
Surabaya|ID|port
Ubud|ID|leaf
Denpasar|ID|temple
Mataram|ID|beach
Manila|PH|port
Cebu City|PH|island
Vigan|PH|village
Baguio|PH|forest
Davao|PH|mountain
Bandar Seri Begawan|BN|dome`],
['west-asian','West Asian',`Istanbul|TR|dome
Ankara|TR|museum
İzmir|TR|port
Antalya|TR|beach
Konya|TR|dome
Göreme|TR|balloon
Tbilisi|GE|balcony
Batumi|GE|beach
Yerevan|AM|mountain
Baku|AZ|skyline
Amman|JO|columns
Aqaba|JO|fish
Muscat|OM|port
Nizwa|OM|castle
Dubai|AE|tower
Abu Dhabi|AE|dome
Sharjah|AE|museum
Doha|QA|sailboat
Manama|BH|skyline
Kuwait City|KW|tower`],
['north-african','North African',`Marrakesh|MA|market
Fes|MA|arch
Rabat|MA|tower
Casablanca|MA|dome
Tangier|MA|port
Chefchaouen|MA|steps
Essaouira|MA|sailboat
Agadir|MA|beach
Tunis|TN|market
Sousse|TN|castle
Kairouan|TN|arch
Hammamet|TN|beach
Tozeur|TN|palm
Algiers|DZ|building
Oran|DZ|port
Constantine|DZ|bridge
Cairo|EG|ruins
Alexandria|EG|lighthouse
Luxor|EG|columns
Aswan|EG|sailboat`],
['west-african','West African',`Dakar|SN|port
Saint-Louis|SN|bridge
Abidjan|CI|skyline
Yamoussoukro|CI|dome
Accra|GH|market
Cape Coast|GH|castle
Kumasi|GH|market
Lomé|TG|beach
Cotonou|BJ|port
Porto-Novo|BJ|museum
Lagos|NG|skyline
Abuja|NG|building
Ibadan|NG|market
Calabar|NG|river
Freetown|SL|beach
Monrovia|LR|port
Banjul|GM|river
Praia|CV|island
Mindelo|CV|music
Bissau|GW|port`],
['east-african','East African',`Nairobi|KE|skyline
Mombasa|KE|port
Kisumu|KE|lake
Nakuru|KE|bird
Lamu|KE|sailboat
Dar es Salaam|TZ|port
Zanzibar City|TZ|arch
Arusha|TZ|mountain
Moshi|TZ|mountain
Mwanza|TZ|lake
Kampala|UG|hills
Entebbe|UG|lake
Jinja|UG|river
Kigali|RW|hills
Musanze|RW|volcano
Addis Ababa|ET|coffee
Gondar|ET|castle
Bahir Dar|ET|lake
Dire Dawa|ET|train
Djibouti|DJ|port`],
['southern-african','Southern African and Indian Ocean',`Cape Town|ZA|mountain
Johannesburg|ZA|skyline
Durban|ZA|beach
Pretoria|ZA|flower
Stellenbosch|ZA|wine
Knysna|ZA|lake
Windhoek|NA|building
Swakopmund|NA|desert
Walvis Bay|NA|bird
Gaborone|BW|hills
Maun|BW|river
Victoria Falls|ZW|waterfall
Harare|ZW|flower
Livingstone|ZM|waterfall
Lusaka|ZM|market
Maputo|MZ|port
Antananarivo|MG|hills
Port Louis|MU|port
Victoria|SC|island
Saint-Denis|RE|volcano`],
['north-american','United States and Canada',`San Francisco|US|bridge
New York|US|skyline
Los Angeles|US|palm
Chicago|US|skyline
Washington|US|columns
Boston|US|book
Seattle|US|tower
Portland|US|bicycle
New Orleans|US|music
Miami|US|beach
Austin|US|music
Denver|US|mountain
Las Vegas|US|star
Honolulu|US|surf
Toronto|CA|tower
Vancouver|CA|mountain
Montréal|CA|bicycle
Québec City|CA|castle
Ottawa|CA|river
Calgary|CA|mountain`],
['mexican-central-american','Mexican and Central American',`Mexico City|MX|museum
Oaxaca|MX|market
Puebla|MX|dome
Mérida|MX|sun
Guadalajara|MX|music
Guanajuato|MX|village
San Miguel de Allende|MX|tower
San Cristóbal de las Casas|MX|village
Puerto Vallarta|MX|beach
Cancún|MX|beach
Antigua Guatemala|GT|volcano
Guatemala City|GT|museum
Flores|GT|island
Belize City|BZ|port
San Salvador|SV|volcano
Copán Ruinas|HN|ruins
León|NI|dome
Granada|NI|lake
San José|CR|coffee
Panama City|PA|skyline`],
['andean','Andean',`Bogotá|CO|mountain
Medellín|CO|cable-car
Cartagena|CO|castle
Cali|CO|music
Santa Marta|CO|beach
Salento|CO|coffee
Quito|EC|volcano
Cuenca|EC|dome
Guayaquil|EC|port
Baños|EC|waterfall
Lima|PE|dining
Cusco|PE|ruins
Arequipa|PE|volcano
Puno|PE|lake
Trujillo|PE|ruins
La Paz|BO|cable-car
Sucre|BO|building
Potosí|BO|mountain
Cochabamba|BO|market
Copacabana|BO|lake`],
['south-american-atlantic','South American Atlantic and Southern Cone',`Rio de Janeiro|BR|mountain
São Paulo|BR|skyline
Salvador|BR|music
Recife|BR|bridge
Olinda|BR|village
Fortaleza|BR|beach
Florianópolis|BR|island
Curitiba|BR|garden-gate
Brasília|BR|building
Manaus|BR|river
Buenos Aires|AR|music
Córdoba|AR|book
Mendoza|AR|wine
Bariloche|AR|mountain
Ushuaia|AR|mountain
Santiago|CL|mountain
Valparaíso|CL|port
Punta Arenas|CL|compass
Montevideo|UY|dining
Colonia del Sacramento|UY|lighthouse`],
['oceanian','Oceanian',`Sydney|AU|sailboat
Melbourne|AU|tram
Brisbane|AU|river
Perth|AU|sunrise
Adelaide|AU|wine
Hobart|AU|port
Darwin|AU|palm
Cairns|AU|fish
Canberra|AU|museum
Gold Coast|AU|surf
Auckland|NZ|sailboat
Wellington|NZ|cable-car
Christchurch|NZ|garden-gate
Queenstown|NZ|mountain
Rotorua|NZ|volcano
Dunedin|NZ|building
Suva|FJ|island
Nadi|FJ|palm
Apia|WS|beach
Papeete|PF|island`]
];
export const slug=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replaceAll('ł','l').replaceAll('ø','o').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const regionNames=Object.fromEntries(groups.map(([id,label])=>[id,label]));
export const destinations=groups.flatMap(([region,,data])=>data.trim().split('\n').map(line=>{const [name,country,symbol]=line.split('|');return {id:`${country.toLowerCase()}-${slug(name)}`,name,country,region,icon:symbol==='boat'?'ferry':symbol==='balcony'?'village':symbol,kind:'destination',iconKind:'generic-fallback'};}));
