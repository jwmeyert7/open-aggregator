/** Compact header search; a plain GET form so it needs no JavaScript. */
export function SearchBox() {
  return (
    <form action="/search" className="search-box" role="search">
      <input type="search" name="q" placeholder="Search" aria-label="Search stories" />
    </form>
  );
}
