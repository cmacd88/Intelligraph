CREATE (alice:Entity:Person {
  uid: randomUUID(), name: 'Alice Nordmann', type: 'Person',
  role: 'Engineer', country: 'NO', x: 0, y: -60,
  confidence: 'confirmed', created: datetime(), updated: datetime()})
CREATE (bob:Entity:Person {
  uid: randomUUID(), name: 'Bob Hansen', type: 'Person',
  role: 'Manager', x: -180, y: 40,
  confidence: 'confirmed', created: datetime(), updated: datetime()})
CREATE (acme:Entity:Company {
  uid: randomUUID(), name: 'Acme Corp', type: 'Company',
  industry: 'Tech', x: 160, y: 40,
  confidence: 'confirmed', created: datetime(), updated: datetime()})
CREATE (dom:Entity:Domain {
  uid: randomUUID(), name: 'acme.com', type: 'Domain',
  registrar: 'GoDaddy', x: -20, y: 170,
  confidence: 'confirmed', created: datetime(), updated: datetime()})
CREATE (ip:Entity:IP {
  uid: randomUUID(), name: '93.184.216.34', type: 'IP',
  country: 'US', x: 140, y: 260,
  confidence: 'probable', created: datetime(), updated: datetime()})
CREATE (mail:Entity:Email {
  uid: randomUUID(), name: 'alice@acme.com', type: 'Email',
  x: 240, y: -90, confidence: 'confirmed',
  created: datetime(), updated: datetime()})
CREATE (oslo:Entity:Location {
  uid: randomUUID(), name: 'Oslo', type: 'Location',
  country: 'NO', x: -240, y: -90,
  confidence: 'confirmed', created: datetime(), updated: datetime()})

CREATE (src:_Source {
  uid: randomUUID(), label: 'Manual entry — sample data',
  kind: 'manual', accessed: datetime()})

CREATE (alice)-[:WORKS_AT {since:'2020', confidence:'confirmed', added:datetime()}]->(acme)
CREATE (bob)-[:WORKS_AT {since:'2018', confidence:'confirmed', added:datetime()}]->(acme)
CREATE (bob)-[:MANAGES {confidence:'probable', added:datetime()}]->(alice)
CREATE (acme)-[:OWNS {confidence:'confirmed', added:datetime()}]->(dom)
CREATE (dom)-[:RESOLVES_TO {confidence:'confirmed', added:datetime()}]->(ip)
CREATE (alice)-[:USES {confidence:'confirmed', added:datetime()}]->(mail)
CREATE (alice)-[:LOCATED_AT {confidence:'probable', added:datetime()}]->(oslo)
CREATE (acme)-[:LOCATED_AT {confidence:'confirmed', added:datetime()}]->(oslo)
CREATE (bob)-[:KNOWS {context:'college', confidence:'probable', added:datetime()}]->(alice)

CREATE (alice)-[:_FROM {confidence:'confirmed', added:datetime()}]->(src)
CREATE (bob)-[:_FROM   {confidence:'confirmed', added:datetime()}]->(src)
CREATE (acme)-[:_FROM  {confidence:'confirmed', added:datetime()}]->(src);
