// Confidence belongs on relationships: an edge is a claim with a truth
// value, an entity mostly is not. Provenance keeps its own confidence on
// the _FROM relationship.
MATCH (n:Entity)
WHERE n.confidence IS NOT NULL
REMOVE n.confidence;
