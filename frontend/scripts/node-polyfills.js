if (!Array.prototype.toReversed) {
  Object.defineProperty(Array.prototype, 'toReversed', {
    value() {
      return Array.from(this).reverse();
    },
    writable: true,
    configurable: true,
  });
}

if (!Array.prototype.toSorted) {
  Object.defineProperty(Array.prototype, 'toSorted', {
    value(compareFn) {
      return Array.from(this).sort(compareFn);
    },
    writable: true,
    configurable: true,
  });
}

if (!Array.prototype.toSpliced) {
  Object.defineProperty(Array.prototype, 'toSpliced', {
    value(start, deleteCount, ...items) {
      const copy = Array.from(this);
      copy.splice(start, deleteCount, ...items);
      return copy;
    },
    writable: true,
    configurable: true,
  });
}
