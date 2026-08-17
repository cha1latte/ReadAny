declare module "foliate-js/opds.js" {
  export const SYMBOL: {
    SUMMARY: symbol;
    CONTENT: symbol;
  };

  export function getFeed(document: Document): unknown;
  export function getOpenSearch(document: Document): unknown;
}
