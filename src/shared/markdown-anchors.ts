// Mismo criterio que GitHub (github-slugger) para las anclas de los títulos.
export function headingSlug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-')
}

// Los títulos repetidos reciben -1, -2… en orden de aparición.
export function headingSlugs(texts: string[]): string[] {
  const seen = new Map<string, number>()
  return texts.map((text) => {
    const base = headingSlug(text)
    let slug = base
    if (seen.has(base)) {
      let count = seen.get(base)!
      do slug = `${base}-${++count}`
      while (seen.has(slug))
      seen.set(base, count)
    }
    seen.set(slug, 0)
    return slug
  })
}
