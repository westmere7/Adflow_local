/**
 * Adflow — Auto-Arrange Configuration Parameters
 * 
 * Edit the specs below to adjust how elements (Heading, Subheading, Button, Logo, Tagline, CRICOS)
 * are positioned and sized when the Auto-arrange layout action is run on different canvas sizes.
 */

const AUTO_ARRANGE_CONFIG = {
  // Configuration for 300x250 canvas size
  "300x250": {
    // Safezone boundaries
    safezone: {
      minX: 15,
      maxX: 288,
      minY: 13,
      maxY: 237,
    },

    // Heading placement parameters
    heading: {
      maxFontSize: 33,
    },

    // Subheading placement parameters
    subheading: {
      maxFontSize: 22,
      gapBelowHeading: 4, // vertical distance between Heading and Subheading boxes
    },

    // CTA Button placement parameters
    button: {
      width: 137,          // default width (1/2 safezone by default)
      gapBelowText: 8,     // vertical distance between subheading/heading box and button box
    },

    // Brand elements: Logo quadrant coordinates (TL: Top-Left, TR: Top-Right, BL: Bottom-Left, BR: Bottom-Right)
    logoCoords: {
      TL: { x: 15,  y: 14,  w: 95, h: 34 },
      TR: { x: 191, y: 14,  w: 95, h: 34 },
      BL: { x: 15,  y: 203, w: 95, h: 34 },
      BR: { x: 192, y: 203, w: 95, h: 34 }
    },

    // Brand elements: CRICOS quadrant coordinates and sizing
    cricos: {
      fontSize: 6,
      coords: {
        TL: { x: 13,  y: 7,   w: 86, h: 10 },
        TR: { x: 205, y: 7,   w: 86, h: 10 },
        BL: { x: 13,  y: 236, w: 86, h: 10 },
        BR: { x: 205, y: 236, w: 86, h: 10 }
      }
    },

    // Brand elements: RFWN Tagline quadrant coordinates and sizing
    tagline: {
      fontSize: 8,
      coords: {
        TL: { x: 14,  y: 12,  w: 50, h: 17 },
        TR: { x: 239, y: 12,  w: 50, h: 17 },
        BL: { x: 14,  y: 218, w: 50, h: 17 },
        BR: { x: 239, y: 218, w: 50, h: 17 }
      }
    }
  },

  // Configuration for 300x600 canvas size
  "300x600": {
    // Safezone boundaries (Shrunk to 20px margins on all sides: Left, Right, Top, Bottom)
    safezone: {
      minX: 20,
      maxX: 280,
      minY: 20,
      maxY: 580,
    },

    // Heading placement parameters
    heading: {
      maxFontSize: 40,
    },

    // Subheading placement parameters
    subheading: {
      maxFontSize: 35,
      gapBelowHeading: 4, // vertical distance between Heading and Subheading boxes
    },

    // CTA Button placement parameters
    button: {
      gapBelowText: 8,     // vertical distance between subheading/heading box and button box
    },

    // Brand elements: Logo quadrant coordinates
    logoCoords: {
      TL: { x: 20,  y: 20,  w: 93, h: 33 },
      TR: { x: 187, y: 20,  w: 93, h: 33 },
      BL: { x: 20,  y: 547, w: 93, h: 33 },
      BR: { x: 187, y: 547, w: 93, h: 33 }
    },
    // Brand elements: RFWN Tagline quadrant coordinates and sizing (adjusted to w: 63, h: 22)
    tagline: {
      fontSize: 11,
      coords: {
        TL: { x: 22,  y: 20,  w: 63, h: 22 },
        TR: { x: 215, y: 20,  w: 63, h: 22 },
        BR: { x: 215, y: 558, w: 63, h: 22 },
        BL: { x: 22,  y: 558, w: 63, h: 22 }
      }
    },
    // Brand elements: CRICOS quadrant coordinates and sizing
    cricos: {
      fontSize: 7,
      coords: {
        TL: { x: 21,  y: 12,  w: 100, h: 12 },
        TR: { x: 179, y: 12,  w: 100, h: 12 },
        BR: { x: 179, y: 580, w: 100, h: 12 },
        BL: { x: 21,  y: 580, w: 100, h: 12 }
      }
    }
  },

  // Configuration for 160x600 canvas size
  "160x600": {
    // Safezone boundaries (19px horizontal margin, 15px vertical margin)
    safezone: {
      minX: 19,
      maxX: 141,
      minY: 15,
      maxY: 585,
    },

    // Heading placement parameters
    heading: {
      maxFontSize: 24,
    },

    // Subheading placement parameters
    subheading: {
      maxFontSize: 18,
      gapBelowHeading: 4, // vertical distance between Heading and Subheading boxes
    },

    // CTA Button placement parameters
    button: {
      gapBelowText: 8,     // vertical distance between subheading/heading box and button box
    },

    // Brand elements: Logo quadrant coordinates (T/B sets mapped to TL/TR and BL/BR)
    logoCoords: {
      TL: { x: 19,  y: 15,  w: 113, h: 40 },
      TR: { x: 19,  y: 15,  w: 113, h: 40 },
      BL: { x: 19,  y: 526, w: 113, h: 40 },
      BR: { x: 19,  y: 526, w: 113, h: 40 }
    },
    // Brand elements: RFWN Tagline quadrant coordinates and sizing
    tagline: {
      fontSize: 9,
      textAlign: 'center',
      coords: {
        TL: { x: 19,  y: 62,  w: 123, h: 15 },
        TR: { x: 19,  y: 62,  w: 123, h: 15 },
        BL: { x: 19,  y: 573, w: 123, h: 15 },
        BR: { x: 19,  y: 573, w: 123, h: 15 }
      }
    },
    // Brand elements: CRICOS quadrant coordinates and sizing (adjusted to size 8, center just., B: 19/582/122/10, T: 19/13/122/10)
    cricos: {
      fontSize: 8,
      textAlign: 'center',
      coords: {
        TL: { x: 19,  y: 13,  w: 122, h: 10 },
        TR: { x: 19,  y: 13,  w: 122, h: 10 },
        BL: { x: 19,  y: 582, w: 122, h: 10 },
        BR: { x: 19,  y: 582, w: 122, h: 10 }
      }
    }
  },

  // Configuration for 728x90 canvas size
  "728x90": {
    safezone: {
      minX: 10,
      maxX: 718,
      minY: 10,
      maxY: 80,
    },
    logoCoords: {
      TL: { x: 607, y: 8, w: 113, h: 40 }
    },
    tagline: {
      fontSize: 8,
      coords: {
        TL: { x: 630, y: 72, w: 90, h: 10 }
      }
    },
    heading: {
      maxFontSize: 28,
      coords: {
        TL: { x: 39, y: 17, w: 368, h: 33 }
      }
    },
    subheading: {
      maxFontSize: 23,
      coords: {
        TL: { x: 39, y: 53, w: 346, h: 21 }
      }
    },
    button: {
      maxFontSize: 20,
      coords: {
        TL: { x: 429, y: 22, w: 144, h: 33 }
      }
    },
    cricos: {
      fontSize: 7,
      coords: {
        TL: { x: 3, y: 77, w: 106, h: 10 }
      }
    }
  },
  "320x50": {
    safezone: {
      minX: 10,
      maxX: 310,
      minY: 5,
      maxY: 45,
    },
    logoCoords: {
      TL: { x: 265, y: 5, w: 50, h: 18 }
    },
    tagline: {
      fontSize: 5,
      coords: {
        TL: { x: 280, y: 32, w: 35, h: 12 }
      }
    },
    button: {
      maxFontSize: 20,
      coords: {
        TL: { x: 143, y: 9, w: 99, h: 25 }
      }
    },
    cricos: {
      fontSize: 5,
      coords: {
        TL: { x: 2, y: 39, w: 72, h: 10 }
      }
    }
  },
  "970x250": {
    safezone: {
      minX: 20,
      maxX: 950,
      minY: 20,
      maxY: 230,
    },
    heading: {
      maxFontSize: 60,
    },
    subheading: {
      maxFontSize: 40,
      gapBelowHeading: 8,
    },
    button: {
      width: 203,
      gapBelowText: 12,
    },
    logoCoords: {
      TL: { x: 13,   y: 13,  w: 158, h: 57 },
      TR: { x: 797,  y: 13,  w: 158, h: 57 },
      BL: { x: 13,   y: 180, w: 158, h: 57 },
      BR: { x: 797,  y: 180, w: 158, h: 57 }
    },
    cricos: {
      fontSize: 8,
      coords: {
        TL: { x: 13,  y: 5,   w: 120, h: 10 },
        TR: { x: 837, y: 5,   w: 120, h: 10 },
        BL: { x: 13,  y: 235, w: 120, h: 10 },
        BR: { x: 837, y: 235, w: 120, h: 10 }
      }
    },
    tagline: {
      fontSize: 16,
      textAlign: 'left',
      coords: {
        TL: { x: 13,  y: 10,  w: 90, h: 40 },
        TR: { x: 865, y: 10,  w: 90, h: 40 },
        BL: { x: 13,  y: 199, w: 90, h: 40 },
        BR: { x: 865, y: 202, w: 90, h: 40 }
      }
    }
  }
};
