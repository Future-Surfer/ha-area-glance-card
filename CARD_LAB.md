# Area Glance Card lab notes

Use the **Living room** preset for the reference light band and **Energy** for the dark system-band variant. The `area-glance-reference` session supplies synthetic entity-registry area assignments so the Lights preset can prove that it only counts lights assigned to `living_room`.

The card is stable once its first Lit render completes; it has no animation or async data fetching. Review desktop and phone widths, then the dark preset. A metric with `hide_unavailable: true` should disappear rather than show an empty cell.
