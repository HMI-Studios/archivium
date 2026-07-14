function toShortname(title) {
  const shortname = title.toLowerCase()
    .replace(/[\s\(\)]/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 64);

  if (validateShortname(shortname) !== null) {
      return '';
  }

  return shortname;
}
