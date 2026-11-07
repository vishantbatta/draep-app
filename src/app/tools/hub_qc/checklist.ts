/**
 * Finishing QC checklist for the Hub QC tool - transcribed from
 * "DRAEP ORDER QC - SAMPLE - FINISHING QC - GENERAL - BLOUSE.csv"
 * (53 checkpoints, 11 sections, trilingual). English descriptions for
 * items 35-41 were corrected to match their Hindi/Kannada text - the
 * CSV rows carried copy-pasted descriptions from other items.
 *
 * Edit this list directly to tune the checklist; statuses are marked
 * at runtime and never persisted.
 */

export interface QcChecklistItem {
  sr: number;
  label: { en: string; hi: string; kn: string };
  description: { en: string; hi: string; kn: string };
}

export interface QcChecklistSection {
  title: { en: string; hi: string; kn: string };
  items: QcChecklistItem[];
}

export const QC_CHECKLIST: QcChecklistSection[] = [
  {
    "title": {
      "en": "A. GENERAL",
      "hi": "सामान्य",
      "kn": "ಸಾಮಾನ್ಯ"
    },
    "items": [
      {
        "sr": 1,
        "label": {
          "en": "Order ID matches production sheet",
          "hi": "ऑर्डर ID प्रोडक्शन शीट से मेल खाता है",
          "kn": "ಆರ್ಡರ್ ID ಪ್ರೊಡಕ್ಷನ್ ಶೀಟ್‌ಗೆ ಹೊಂದುತ್ತದೆ"
        },
        "description": {
          "en": "Check that the Order ID on the garment tag matches the ID on the production sheet.",
          "hi": "जाँचें कि गारमेंट टैग पर लिखा ऑर्डर ID प्रोडक्शन शीट के ID से मेल खाता है।",
          "kn": "ಗಾರ್ಮೆಂಟ್ ಟ್ಯಾಗ್‌ನಲ್ಲಿರುವ ಆರ್ಡರ್ ID ಪ್ರೊಡಕ್ಷನ್ ಶೀಟ್‌ನ ID ಗೆ ಹೊಂದುತ್ತದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಿ."
        }
      },
      {
        "sr": 2,
        "label": {
          "en": "Correct customer name",
          "hi": "सही ग्राहक का नाम",
          "kn": "ಸರಿಯಾದ ಗ್ರಾಹಕರ ಹೆಸರು"
        },
        "description": {
          "en": "Verify the customer name on the order matches the name on the production sheet.",
          "hi": "सुनिश्चित करें कि ऑर्डर पर ग्राहक का नाम प्रोडक्शन शीट के नाम से मेल खाता है।",
          "kn": "ಆರ್ಡರ್‌ನಲ್ಲಿರುವ ಗ್ರಾಹಕರ ಹೆಸರು ಪ್ರೊಡಕ್ಷನ್ ಶೀಟ್‌ನ ಹೆಸರಿಗೆ ಹೊಂದುತ್ತದೆಯೇ ಎಂದು ಖಚಿತಪಡಿಸಿ."
        }
      },
      {
        "sr": 3,
        "label": {
          "en": "Correct design version stitched",
          "hi": "सही डिज़ाइन वर्ज़न सिला गया है",
          "kn": "ಸರಿಯಾದ ವಿನ್ಯಾಸ ಆವೃತ್ತಿ ಹೊಲಿಯಲಾಗಿದೆ"
        },
        "description": {
          "en": "Confirm the stitched blouse follows the final approved design version, not an older one.",
          "hi": "पुष्टि करें कि सिला हुआ ब्लाउज़ अंतिम स्वीकृत डिज़ाइन वर्ज़न के अनुसार है, किसी पुराने वर्ज़न के नहीं।",
          "kn": "ಹೊಲಿದ ಬ್ಲೌಸ್ ಅಂತಿಮ ಅನುಮೋದಿತ ವಿನ್ಯಾಸ ಆವೃತ್ತಿಯಂತೆ ಇದೆಯೇ ಎಂದು ಖಚಿತಪಡಿಸಿ, ಹಳೆಯ ಆವೃತ್ತಿಯಂತೆ ಅಲ್ಲ."
        }
      },
      {
        "sr": 4,
        "label": {
          "en": "Correct fabric used",
          "hi": "सही कपड़े का उपयोग हुआ है",
          "kn": "ಸರಿಯಾದ ಬಟ್ಟೆ ಬಳಸಲಾಗಿದೆ"
        },
        "description": {
          "en": "Match the fabric type, colour and quality with the fabric mentioned in the order.",
          "hi": "कपड़े का प्रकार, रंग और गुणवत्ता ऑर्डर में दिए गए कपड़े से मिलाएँ।",
          "kn": "ಬಟ್ಟೆಯ ಪ್ರಕಾರ, ಬಣ್ಣ ಮತ್ತು ಗುಣಮಟ್ಟವನ್ನು ಆರ್ಡರ್‌ನಲ್ಲಿ ನೀಡಿರುವ ಬಟ್ಟೆಯೊಂದಿಗೆ ಹೋಲಿಸಿ."
        }
      },
      {
        "sr": 5,
        "label": {
          "en": "All accessories attached as per order",
          "hi": "ऑर्डर के अनुसार सभी एक्सेसरीज़ लगी हैं",
          "kn": "ಆರ್ಡರ್ ಪ್ರಕಾರ ಎಲ್ಲಾ ಪರಿಕರಗಳನ್ನು ಜೋಡಿಸಲಾಗಿದೆ"
        },
        "description": {
          "en": "Ensure all accessories like dori, tassels, lace and buttons listed in the order are attached.",
          "hi": "सुनिश्चित करें कि ऑर्डर में लिखी सभी एक्सेसरीज़ जैसे डोरी, टैसल (लटकन), लेस और बटन लगे हों।",
          "kn": "ಆರ್ಡರ್‌ನಲ್ಲಿ ಬರೆದಿರುವ ಡೋರಿ, ಟಸಲ್, ಲೇಸ್ ಮತ್ತು ಬಟನ್‌ಗಳಂತಹ ಎಲ್ಲಾ ಪರಿಕರಗಳು ಜೋಡಿಸಿವೆಯೇ ಎಂದು ಖಚಿತಪಡಿಸಿ."
        }
      }
    ]
  },
  {
    "title": {
      "en": "A. SHOULDER",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 6,
        "label": {
          "en": "Shoulder seam straight",
          "hi": "कंधे की सिलाई (सीम) सीधी है",
          "kn": "ಭುಜದ ಹೊಲಿಗೆ (ಸೀಮ್) ನೇರವಾಗಿದೆ"
        },
        "description": {
          "en": "The shoulder seam should run in a straight line without curving or twisting.",
          "hi": "कंधे की सीम बिना मुड़े या टेढ़ी हुए एक सीधी रेखा में होनी चाहिए।",
          "kn": "ಭುಜದ ಸೀಮ್ ವಕ್ರವಾಗದೆ ಅಥವಾ ತಿರುಚದೆ ನೇರ ರೇಖೆಯಲ್ಲಿ ಇರಬೇಕು."
        }
      },
      {
        "sr": 7,
        "label": {
          "en": "Both shoulders symmetrical",
          "hi": "दोनों कंधे एक समान (सिमेट्रिकल) हैं",
          "kn": "ಎರಡೂ ಭುಜಗಳು ಸಮವಾಗಿವೆ"
        },
        "description": {
          "en": "Compare left and right shoulders — width, slope and stitching should be identical.",
          "hi": "बाएँ और दाएँ कंधे की चौड़ाई, ढलान और सिलाई एक जैसी होनी चाहिए।",
          "kn": "ಎಡ ಮತ್ತು ಬಲ ಭುಜಗಳ ಅಗಲ, ಇಳಿಜಾರು ಮತ್ತು ಹೊಲಿಗೆ ಒಂದೇ ರೀತಿಯಾಗಿರಬೇಕು."
        }
      },
      {
        "sr": 8,
        "label": {
          "en": "Shoulder patti stitched firmly",
          "hi": "कंधे की पट्टी मज़बूती से सिली गई है",
          "kn": "ಭುಜದ ಪಟ್ಟಿ ಗಟ್ಟಿಯಾಗಿ ಹೊಲಿಯಲಾಗಿದೆ"
        },
        "description": {
          "en": "Pull the shoulder patti gently — it should be firmly stitched with no loose threads.",
          "hi": "कंधे की पट्टी को हल्के से खींचकर देखें — वह मज़बूती से सिली हो और कोई ढीला धागा न हो।",
          "kn": "ಭುಜದ ಪಟ್ಟಿಯನ್ನು ನಿಧಾನವಾಗಿ ಎಳೆದು ನೋಡಿ — ಅದು ಗಟ್ಟಿಯಾಗಿ ಹೊಲಿದಿರಬೇಕು ಮತ್ತು ಸಡಿಲ ದಾರ ಇರಬಾರದು."
        }
      },
      {
        "sr": 9,
        "label": {
          "en": "No puckering at shoulder joint",
          "hi": "कंधे के जोड़ पर कपड़ा सिकुड़ा (पकरिंग) नहीं है",
          "kn": "ಭುಜದ ಜೋಡಣೆಯಲ್ಲಿ ಬಟ್ಟೆ ಮುದುಡಿಲ್ಲ"
        },
        "description": {
          "en": "The fabric at the shoulder joint should lie flat without gathering or wrinkles.",
          "hi": "कंधे के जोड़ पर कपड़ा बिना सिकुड़न या झुर्रियों के सपाट होना चाहिए।",
          "kn": "ಭುಜದ ಜೋಡಣೆಯ ಬಳಿ ಬಟ್ಟೆ ಮಡಿಕೆ ಅಥವಾ ಸುಕ್ಕು ಇಲ್ಲದೆ ಸಮತಟ್ಟಾಗಿರಬೇಕು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "B. NECK",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 10,
        "label": {
          "en": "Neck width correct",
          "hi": "गले की चौड़ाई सही है",
          "kn": "ಕುತ್ತಿಗೆಯ ಅಗಲ ಸರಿಯಾಗಿದೆ"
        },
        "description": {
          "en": "Measure the neck width and match it with the measurement in the spec sheet.",
          "hi": "गले की चौड़ाई नापें और स्पेक शीट में दिए माप से मिलाएँ।",
          "kn": "ಕುತ್ತಿಗೆಯ ಅಗಲವನ್ನು ಅಳೆದು ಸ್ಪೆಕ್ ಶೀಟ್‌ನಲ್ಲಿರುವ ಅಳತೆಯೊಂದಿಗೆ ಹೋಲಿಸಿ."
        }
      },
      {
        "sr": 11,
        "label": {
          "en": "Neck shape matches design",
          "hi": "गले का आकार डिज़ाइन से मेल खाता है",
          "kn": "ಕುತ್ತಿಗೆಯ ಆಕಾರ ವಿನ್ಯಾಸಕ್ಕೆ ಹೊಂದುತ್ತದೆ"
        },
        "description": {
          "en": "The neckline shape (round, V, boat, etc.) should exactly match the approved design.",
          "hi": "नेकलाइन का आकार (गोल, V, बोट आदि) स्वीकृत डिज़ाइन से बिल्कुल मेल खाना चाहिए।",
          "kn": "ನೆಕ್‌ಲೈನ್ ಆಕಾರ (ರೌಂಡ್, V, ಬೋಟ್ ಇತ್ಯಾದಿ) ಅನುಮೋದಿತ ವಿನ್ಯಾಸಕ್ಕೆ ನಿಖರವಾಗಿ ಹೊಂದಬೇಕು."
        }
      },
      {
        "sr": 12,
        "label": {
          "en": "Neck piping even",
          "hi": "गले की पाइपिंग एक समान है",
          "kn": "ಕುತ್ತಿಗೆಯ ಪೈಪಿಂಗ್ ಸಮವಾಗಿದೆ"
        },
        "description": {
          "en": "Piping around the neck should be of even width all around, with no twists.",
          "hi": "गले के चारों ओर पाइपिंग की चौड़ाई एक समान होनी चाहिए और कहीं मुड़ी न हो।",
          "kn": "ಕುತ್ತಿಗೆಯ ಸುತ್ತ ಪೈಪಿಂಗ್ ಅಗಲ ಎಲ್ಲೆಡೆ ಸಮವಾಗಿರಬೇಕು, ಎಲ್ಲಿಯೂ ತಿರುಚಿರಬಾರದು."
        }
      },
      {
        "sr": 13,
        "label": {
          "en": "Neck finishing clean",
          "hi": "गले की फिनिशिंग साफ़ है",
          "kn": "ಕುತ್ತಿಗೆಯ ಫಿನಿಶಿಂಗ್ ಸ್ವಚ್ಛವಾಗಿದೆ"
        },
        "description": {
          "en": "The neckline should be neatly finished with no raw edges or loose threads visible.",
          "hi": "नेकलाइन साफ़-सुथरी फिनिश हो, कोई कच्चा किनारा या ढीला धागा न दिखे।",
          "kn": "ನೆಕ್‌ಲೈನ್ ಅಚ್ಚುಕಟ್ಟಾಗಿ ಫಿನಿಶ್ ಆಗಿರಬೇಕು; ಕಚ್ಚಾ ಅಂಚು ಅಥವಾ ಸಡಿಲ ದಾರ ಕಾಣಬಾರದು."
        }
      },
      {
        "sr": 14,
        "label": {
          "en": "Neck lies flat",
          "hi": "गला सपाट बैठता है",
          "kn": "ಕುತ್ತಿಗೆ ಭಾಗ ಸಮತಟ್ಟಾಗಿ ಕೂರುತ್ತದೆ"
        },
        "description": {
          "en": "The neckline should sit flat against the body without gaping or rolling.",
          "hi": "नेकलाइन शरीर पर सपाट बैठनी चाहिए — न कहीं से खुले (गैप) और न मुड़े।",
          "kn": "ನೆಕ್‌ಲೈನ್ ದೇಹಕ್ಕೆ ಸಮತಟ್ಟಾಗಿ ಕೂರಬೇಕು; ತೆರೆದುಕೊಳ್ಳಬಾರದು ಅಥವಾ ಮಡಚಿಕೊಳ್ಳಬಾರದು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "C. ARMHOLE AND SLEEVES",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 15,
        "label": {
          "en": "Sleeve joined evenly",
          "hi": "आस्तीन समान रूप से जुड़ी है",
          "kn": "ತೋಳನ್ನು ಸಮವಾಗಿ ಜೋಡಿಸಲಾಗಿದೆ"
        },
        "description": {
          "en": "The sleeve should be attached smoothly around the armhole with even seams.",
          "hi": "आस्तीन आर्महोल के चारों ओर समान सीम के साथ अच्छी तरह जुड़ी होनी चाहिए।",
          "kn": "ತೋಳು ಆರ್ಮ್‌ಹೋಲ್ ಸುತ್ತ ಸಮ ಸೀಮ್‌ನೊಂದಿಗೆ ಸರಾಗವಾಗಿ ಜೋಡಣೆಯಾಗಿರಬೇಕು."
        }
      },
      {
        "sr": 16,
        "label": {
          "en": "No gathering or wrinkles",
          "hi": "कोई सिकुड़न या झुर्रियाँ नहीं हैं",
          "kn": "ಮಡಿಕೆ ಅಥವಾ ಸುಕ್ಕುಗಳಿಲ್ಲ"
        },
        "description": {
          "en": "There should be no unwanted gathering or wrinkles where the sleeve meets the armhole.",
          "hi": "जहाँ आस्तीन आर्महोल से मिलती है वहाँ कोई अनचाही सिकुड़न या झुर्री न हो।",
          "kn": "ತೋಳು ಆರ್ಮ್‌ಹೋಲ್ ಸೇರುವ ಜಾಗದಲ್ಲಿ ಬೇಡದ ಮಡಿಕೆ ಅಥವಾ ಸುಕ್ಕು ಇರಬಾರದು."
        }
      },
      {
        "sr": 17,
        "label": {
          "en": "Both sleeves equal",
          "hi": "दोनों आस्तीन बराबर हैं",
          "kn": "ಎರಡೂ ತೋಳುಗಳು ಸಮಾನವಾಗಿವೆ"
        },
        "description": {
          "en": "Both sleeves should be equal in length, width and design.",
          "hi": "दोनों आस्तीन लंबाई, चौड़ाई और डिज़ाइन में बराबर होनी चाहिए।",
          "kn": "ಎರಡೂ ತೋಳುಗಳು ಉದ್ದ, ಅಗಲ ಮತ್ತು ವಿನ್ಯಾಸದಲ್ಲಿ ಸಮಾನವಾಗಿರಬೇಕು."
        }
      },
      {
        "sr": 18,
        "label": {
          "en": "Sleeve hem clean",
          "hi": "आस्तीन का हेम साफ़ है",
          "kn": "ತೋಳಿನ ಹೆಮ್ ಸ್ವಚ್ಛವಾಗಿದೆ"
        },
        "description": {
          "en": "The sleeve hem should be evenly folded and neatly stitched without raw edges.",
          "hi": "आस्तीन का हेम समान मोड़ के साथ साफ़ सिला होना चाहिए, कच्चे किनारे न हों।",
          "kn": "ತೋಳಿನ ಹೆಮ್ ಸಮವಾಗಿ ಮಡಚಿ ಅಚ್ಚುಕಟ್ಟಾಗಿ ಹೊಲಿದಿರಬೇಕು; ಕಚ್ಚಾ ಅಂಚು ಇರಬಾರದು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "D. BUST & FIT",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 19,
        "label": {
          "en": "Princess line aligned",
          "hi": "प्रिंसेस लाइन सही संरेखित है",
          "kn": "ಪ್ರಿನ್ಸೆಸ್ ಲೈನ್ ಸರಿಯಾಗಿ ಹೊಂದಿಕೊಂಡಿದೆ"
        },
        "description": {
          "en": "Princess cut lines on both sides should be smooth, symmetrical and correctly placed over the bust.",
          "hi": "दोनों तरफ़ की प्रिंसेस कट लाइनें बस्ट पर सही जगह, चिकनी और एक समान होनी चाहिए।",
          "kn": "ಎರಡೂ ಬದಿಯ ಪ್ರಿನ್ಸೆಸ್ ಕಟ್ ರೇಖೆಗಳು ಎದೆಯ ಮೇಲೆ ಸರಿಯಾದ ಸ್ಥಳದಲ್ಲಿ, ನಯವಾಗಿ ಮತ್ತು ಸಮವಾಗಿರಬೇಕು."
        }
      },
      {
        "sr": 20,
        "label": {
          "en": "Cups aligned properly (if applicable)",
          "hi": "कप सही संरेखित हैं (यदि लागू हो)",
          "kn": "ಕಪ್‌ಗಳು ಸರಿಯಾಗಿ ಹೊಂದಿಕೊಂಡಿವೆ (ಅನ್ವಯಿಸಿದರೆ)"
        },
        "description": {
          "en": "If padded cups are used, both should sit at the same height and position without shifting.",
          "hi": "यदि पैडेड कप लगे हैं, तो दोनों एक ही ऊँचाई और स्थिति पर हों और खिसकें नहीं।",
          "kn": "ಪ್ಯಾಡೆಡ್ ಕಪ್ ಬಳಸಿದ್ದರೆ, ಎರಡೂ ಒಂದೇ ಎತ್ತರ ಮತ್ತು ಸ್ಥಾನದಲ್ಲಿರಬೇಕು, ಜರುಗಬಾರದು."
        }
      },
      {
        "sr": 21,
        "label": {
          "en": "No pulling around bust",
          "hi": "बस्ट के आसपास कपड़ा खिंचता नहीं है",
          "kn": "ಎದೆಯ ಸುತ್ತ ಬಟ್ಟೆ ಎಳೆತವಿಲ್ಲ"
        },
        "description": {
          "en": "The fabric around the bust should not show tension lines or pulling.",
          "hi": "बस्ट के आसपास कपड़े पर खिंचाव की लकीरें नहीं दिखनी चाहिए।",
          "kn": "ಎದೆಯ ಸುತ್ತ ಬಟ್ಟೆಯ ಮೇಲೆ ಎಳೆತದ ಗೆರೆಗಳು ಕಾಣಬಾರದು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "E. WAIST & LENGTH",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 22,
        "label": {
          "en": "Bottom hem level",
          "hi": "नीचे का हेम बराबर (लेवल) है",
          "kn": "ಕೆಳಗಿನ ಹೆಮ್ ಸಮಮಟ್ಟದಲ್ಲಿದೆ"
        },
        "description": {
          "en": "The bottom hem should be level all around, without dipping or rising anywhere.",
          "hi": "नीचे का हेम चारों ओर बराबर होना चाहिए, कहीं ऊपर-नीचे न हो।",
          "kn": "ಕೆಳಗಿನ ಹೆಮ್ ಸುತ್ತಲೂ ಸಮಮಟ್ಟದಲ್ಲಿರಬೇಕು; ಎಲ್ಲಿಯೂ ಮೇಲೆ-ಕೆಳಗೆ ಆಗಿರಬಾರದು."
        }
      },
      {
        "sr": 23,
        "label": {
          "en": "Both sides equal",
          "hi": "दोनों साइड की लंबाई बराबर है",
          "kn": "ಎರಡೂ ಬದಿಗಳ ಉದ್ದ ಸಮಾನವಾಗಿದೆ"
        },
        "description": {
          "en": "Left and right side lengths of the blouse should measure exactly the same.",
          "hi": "ब्लाउज़ की बाईं और दाईं साइड की लंबाई बिल्कुल बराबर होनी चाहिए।",
          "kn": "ಬ್ಲೌಸ್‌ನ ಎಡ ಮತ್ತು ಬಲ ಬದಿಗಳ ಉದ್ದ ನಿಖರವಾಗಿ ಸಮಾನವಾಗಿರಬೇಕು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "F. LINING & INNER FINISH",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 24,
        "label": {
          "en": "Lining attached correctly",
          "hi": "अस्तर सही तरीके से लगा है",
          "kn": "ಲೈನಿಂಗ್ ಸರಿಯಾಗಿ ಜೋಡಿಸಲಾಗಿದೆ"
        },
        "description": {
          "en": "The lining should be smoothly attached to the outer fabric without bunching or twisting.",
          "hi": "अस्तर बाहरी कपड़े से बिना गुच्छे या मरोड़ के अच्छी तरह जुड़ा होना चाहिए।",
          "kn": "ಲೈನಿಂಗ್ ಹೊರ ಬಟ್ಟೆಗೆ ಗಂಟಾಗದೆ ಅಥವಾ ತಿರುಚದೆ ಸರಾಗವಾಗಿ ಜೋಡಣೆಯಾಗಿರಬೇಕು."
        }
      },
      {
        "sr": 25,
        "label": {
          "en": "Lining not visible externally",
          "hi": "अस्तर बाहर से दिखाई नहीं देता",
          "kn": "ಲೈನಿಂಗ್ ಹೊರಗಿನಿಂದ ಕಾಣುವುದಿಲ್ಲ"
        },
        "description": {
          "en": "No part of the lining should peek out at the neckline, hems or sleeves.",
          "hi": "गले, हेम या आस्तीन पर अस्तर का कोई हिस्सा बाहर नहीं दिखना चाहिए।",
          "kn": "ಕುತ್ತಿಗೆ, ಹೆಮ್ ಅಥವಾ ತೋಳುಗಳಲ್ಲಿ ಲೈನಿಂಗ್‌ನ ಯಾವುದೇ ಭಾಗ ಹೊರಗೆ ಕಾಣಬಾರದು."
        }
      },
      {
        "sr": 26,
        "label": {
          "en": "No exposed raw edges",
          "hi": "कोई कच्चा किनारा खुला नहीं है",
          "kn": "ಕಚ್ಚಾ ಅಂಚುಗಳು ತೆರೆದಿಲ್ಲ"
        },
        "description": {
          "en": "All inner edges should be overlocked or finished — no fraying fabric edges should be visible.",
          "hi": "सभी अंदरूनी किनारे ओवरलॉक या फिनिश होने चाहिए — कोई उधड़ता किनारा न दिखे।",
          "kn": "ಎಲ್ಲಾ ಒಳ ಅಂಚುಗಳು ಓವರ್‌ಲಾಕ್ ಅಥವಾ ಫಿನಿಶ್ ಆಗಿರಬೇಕು — ಬಿಚ್ಚಿಕೊಳ್ಳುವ ಅಂಚು ಕಾಣಬಾರದು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "G. CLOSURES & ACCESSORIES",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 27,
        "label": {
          "en": "Hooks/Buttons/Chain stitched securely",
          "hi": "हुक/बटन/चेन मज़बूती से सिले हैं",
          "kn": "ಹುಕ್/ಬಟನ್/ಚೈನ್ ಗಟ್ಟಿಯಾಗಿ ಹೊಲಿಯಲಾಗಿದೆ"
        },
        "description": {
          "en": "Pull each hook, button and chain gently to confirm they are firmly stitched.",
          "hi": "हर हुक, बटन और चेन को हल्के से खींचकर देखें कि वे मज़बूती से सिले हैं।",
          "kn": "ಪ್ರತಿ ಹುಕ್, ಬಟನ್ ಮತ್ತು ಚೈನ್ ಅನ್ನು ನಿಧಾನವಾಗಿ ಎಳೆದು ಗಟ್ಟಿಯಾಗಿ ಹೊಲಿದಿದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಿ."
        }
      },
      {
        "sr": 28,
        "label": {
          "en": "Hooks/Buttons/Chain alignment correct",
          "hi": "हुक/बटन/चेन का संरेखण (अलाइनमेंट) सही है",
          "kn": "ಹುಕ್/ಬಟನ್/ಚೈನ್ ಜೋಡಣೆ ಸರಿಯಾಗಿದೆ"
        },
        "description": {
          "en": "When closed, both sides should meet evenly without the fabric shifting up or down.",
          "hi": "बंद करने पर दोनों साइड बराबर मिलनी चाहिए, कपड़ा ऊपर-नीचे नहीं खिसकना चाहिए।",
          "kn": "ಮುಚ್ಚಿದಾಗ ಎರಡೂ ಬದಿಗಳು ಸಮವಾಗಿ ಸೇರಬೇಕು; ಬಟ್ಟೆ ಮೇಲೆ-ಕೆಳಗೆ ಜರುಗಬಾರದು."
        }
      },
      {
        "sr": 29,
        "label": {
          "en": "Hooks/Buttons/Chain placement correct",
          "hi": "हुक/बटन/चेन की जगह सही है",
          "kn": "ಹುಕ್/ಬಟನ್/ಚೈನ್ ಸ್ಥಾನ ಸರಿಯಾಗಿದೆ"
        },
        "description": {
          "en": "Hooks, buttons and chain should be placed at the exact positions given in the design/spec.",
          "hi": "हुक, बटन और चेन डिज़ाइन/स्पेक में दी गई सही जगहों पर लगे होने चाहिए।",
          "kn": "ಹುಕ್, ಬಟನ್ ಮತ್ತು ಚೈನ್ ವಿನ್ಯಾಸ/ಸ್ಪೆಕ್‌ನಲ್ಲಿ ನೀಡಿರುವ ನಿಖರ ಸ್ಥಳಗಳಲ್ಲಿ ಇರಬೇಕು."
        }
      },
      {
        "sr": 30,
        "label": {
          "en": "Bra Strap Hook / Strap Holder",
          "hi": "ब्रा स्ट्रैप हुक",
          "kn": "ಬ್ರಾ ಸ್ಟ್ರ್ಯಾಪ್ ಹುಕ್:"
        },
        "description": {
          "en": "Securely stitched, correctly positioned and aligned; ensure no looseness, protrusion or discomfort.",
          "hi": "सही जगह पर मजबूती से सिला और अलाइन किया हुआ हो; ढीलापन, बाहर निकलना या असुविधा न हो।",
          "kn": "ಸರಿಯಾದ ಸ್ಥಳದಲ್ಲಿ ಗಟ್ಟಿಯಾಗಿ ಹೊಲೆಯಲ್ಪಟ್ಟಿದ್ದು ಮತ್ತು ಸರಿಯಾಗಿ ಹೊಂದಿಕೊಂಡಿರಬೇಕು; ಸಡಿಲವಾಗಿರಬಾರದು, ಹೊರಗೆ ಕಾಣಿಸಿಕೊಳ್ಳಬಾರದು ಅಥವಾ ಅಸೌಕರ್ಯ ಉಂಟುಮಾಡಬಾರದು."
        }
      },
      {
        "sr": 31,
        "label": {
          "en": "Zip functioning smoothly (if applicable)",
          "hi": "ज़िप आसानी से चलती है (यदि लागू हो)",
          "kn": "ಜಿಪ್ ಸರಾಗವಾಗಿ ಕೆಲಸ ಮಾಡುತ್ತದೆ (ಅನ್ವಯಿಸಿದರೆ)"
        },
        "description": {
          "en": "Open and close the zip fully 2–3 times — it should move smoothly without catching the fabric.",
          "hi": "ज़िप को 2–3 बार पूरा खोलें-बंद करें — वह बिना कपड़ा फँसे आसानी से चलनी चाहिए।",
          "kn": "ಜಿಪ್ ಅನ್ನು 2–3 ಬಾರಿ ಪೂರ್ತಿ ತೆರೆದು-ಮುಚ್ಚಿ ನೋಡಿ — ಬಟ್ಟೆ ಸಿಕ್ಕಿಕೊಳ್ಳದೆ ಸರಾಗವಾಗಿ ಚಲಿಸಬೇಕು."
        }
      },
      {
        "sr": 32,
        "label": {
          "en": "Dori stitched firmly",
          "hi": "डोरी मज़बूती से सिली है",
          "kn": "ಡೋರಿ ಗಟ್ಟಿಯಾಗಿ ಹೊಲಿಯಲಾಗಿದೆ"
        },
        "description": {
          "en": "The dori (back tie) should be strongly stitched at its base and not come loose when pulled.",
          "hi": "डोरी (पीछे की बाँधने वाली) अपनी जड़ पर मज़बूती से सिली हो और खींचने पर न निकले।",
          "kn": "ಡೋರಿ (ಹಿಂಭಾಗದ ಕಟ್ಟು) ಬುಡದಲ್ಲಿ ಗಟ್ಟಿಯಾಗಿ ಹೊಲಿದಿರಬೇಕು; ಎಳೆದಾಗ ಸಡಿಲವಾಗಬಾರದು."
        }
      },
      {
        "sr": 33,
        "label": {
          "en": "Tassels attached (if applicable)",
          "hi": "टैसल (लटकन) लगे हैं (यदि लागू हो)",
          "kn": "ಟಸಲ್‌ಗಳನ್ನು ಜೋಡಿಸಲಾಗಿದೆ (ಅನ್ವಯಿಸಿದರೆ)"
        },
        "description": {
          "en": "If the design includes tassels, they should be securely attached and matching in size and colour.",
          "hi": "यदि डिज़ाइन में टैसल हैं, तो वे मज़बूती से लगे हों और आकार व रंग में एक जैसे हों।",
          "kn": "ವಿನ್ಯಾಸದಲ್ಲಿ ಟಸಲ್ ಇದ್ದರೆ, ಅವು ಭದ್ರವಾಗಿ ಜೋಡಿಸಿರಬೇಕು ಮತ್ತು ಗಾತ್ರ-ಬಣ್ಣದಲ್ಲಿ ಹೊಂದಿಕೆಯಾಗಿರಬೇಕು."
        }
      },
      {
        "sr": 34,
        "label": {
          "en": "Lace/Patchwork matches design",
          "hi": "लेस/पैचवर्क डिज़ाइन से मेल खाता है",
          "kn": "ಲೇಸ್/ಪ್ಯಾಚ್‌ವರ್ಕ್ ವಿನ್ಯಾಸಕ್ಕೆ ಹೊಂದುತ್ತದೆ"
        },
        "description": {
          "en": "Lace and patchwork should match the approved design in placement, pattern and colour.",
          "hi": "लेस और पैचवर्क जगह, पैटर्न और रंग में स्वीकृत डिज़ाइन से मेल खाने चाहिए।",
          "kn": "ಲೇಸ್ ಮತ್ತು ಪ್ಯಾಚ್‌ವರ್ಕ್ ಸ್ಥಳ, ಪ್ಯಾಟರ್ನ್ ಮತ್ತು ಬಣ್ಣದಲ್ಲಿ ಅನುಮೋದಿತ ವಿನ್ಯಾಸಕ್ಕೆ ಹೊಂದಬೇಕು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "H. STITCH QUALITY",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 35,
        "label": {
          "en": "Stitch density consistent",
          "hi": "सिलाई का घनत्व एक समान है",
          "kn": "ಹೊಲಿಗೆ ಸಾಂದ್ರತೆ ಸಮವಾಗಿದೆ"
        },
        "description": {
          "en": "Stitches per inch should be uniform across every seam - neither loose nor overly tight anywhere.",
          "hi": "हर सीम में प्रति इंच टाँकों की संख्या एक समान हो — कहीं ढीली या बहुत कसी सिलाई न हो।",
          "kn": "ಎಲ್ಲಾ ಸೀಮ್‌ಗಳಲ್ಲಿ ಪ್ರತಿ ಇಂಚಿಗೆ ಹೊಲಿಗೆಗಳ ಸಂಖ್ಯೆ ಸಮವಾಗಿರಬೇಕು — ಸಡಿಲ ಅಥವಾ ಅತಿ ಬಿಗಿ ಭಾಗ ಇರಬಾರದು."
        }
      },
      {
        "sr": 36,
        "label": {
          "en": "No skipped stitches",
          "hi": "कोई छूटा हुआ टाँका नहीं है",
          "kn": "ಬಿಟ್ಟುಹೋದ ಹೊಲಿಗೆಗಳಿಲ್ಲ"
        },
        "description": {
          "en": "Check all seams for skipped stitches where the thread failed to catch the fabric.",
          "hi": "सभी सीम जाँचें कि कहीं टाँका छूटा तो नहीं, जहाँ धागा कपड़े को पकड़ नहीं पाया।",
          "kn": "ದಾರ ಬಟ್ಟೆಯನ್ನು ಹಿಡಿಯದೆ ಹೊಲಿಗೆ ಬಿಟ್ಟುಹೋಗಿದೆಯೇ ಎಂದು ಎಲ್ಲಾ ಸೀಮ್‌ಗಳನ್ನು ಪರಿಶೀಲಿಸಿ."
        }
      },
      {
        "sr": 37,
        "label": {
          "en": "No broken stitches",
          "hi": "कोई टूटा टाँका नहीं है",
          "kn": "ಮುರಿದ ಹೊಲಿಗೆಗಳಿಲ್ಲ"
        },
        "description": {
          "en": "No broken or cut thread should appear on any seam.",
          "hi": "किसी भी सीम पर टूटा या कटा धागा नहीं होना चाहिए।",
          "kn": "ಯಾವುದೇ ಸೀಮ್‌ನಲ್ಲಿ ಮುರಿದ ಅಥವಾ ಕತ್ತರಿಸಿದ ದಾರ ಇರಬಾರದು."
        }
      },
      {
        "sr": 38,
        "label": {
          "en": "Thread colour matches fabric",
          "hi": "धागे का रंग कपड़े से मेल खाता है",
          "kn": "ದಾರದ ಬಣ್ಣ ಬಟ್ಟೆಗೆ ಹೊಂದುತ್ತದೆ"
        },
        "description": {
          "en": "Thread colour should match the fabric unless the design calls for a contrast thread.",
          "hi": "धागे का रंग कपड़े से मिलना चाहिए, जब तक डिज़ाइन में कंट्रास्ट धागा न हो।",
          "kn": "ವಿನ್ಯಾಸದಲ್ಲಿ ಕಾಂಟ್ರಾಸ್ಟ್ ದಾರ ಇಲ್ಲದಿದ್ದರೆ, ದಾರದ ಬಣ್ಣ ಬಟ್ಟೆಯೊಂದಿಗೆ ಬೆರೆಯಬೇಕು."
        }
      },
      {
        "sr": 39,
        "label": {
          "en": "Thread tension uniform",
          "hi": "धागे का तनाव (टेंशन) एक समान है",
          "kn": "ದಾರದ ಟೆನ್ಷನ್ ಸಮವಾಗಿದೆ"
        },
        "description": {
          "en": "Stitches should be neither too tight (puckering) nor too loose (looping) anywhere.",
          "hi": "टाँके कहीं भी न बहुत कसे हों (सिकुड़न) और न बहुत ढीले (लूप)।",
          "kn": "ಹೊಲಿಗೆಗಳು ಎಲ್ಲಿಯೂ ಅತಿ ಬಿಗಿ (ಸುಕ್ಕು) ಅಥವಾ ಅತಿ ಸಡಿಲ (ಲೂಪ್) ಆಗಿರಬಾರದು."
        }
      },
      {
        "sr": 40,
        "label": {
          "en": "Seam allowance maintained",
          "hi": "सीम अलाउंस बनाए रखा गया है",
          "kn": "ಸೀಮ್ ಅಲೋವನ್ಸ್ ಕಾಪಾಡಲಾಗಿದೆ"
        },
        "description": {
          "en": "Enough seam allowance should be left inside for strength and future fitting changes.",
          "hi": "मज़बूती और आगे की फिटिंग बदलाव के लिए अंदर पर्याप्त सीम अलाउंस छोड़ा गया हो।",
          "kn": "ಗಟ್ಟಿತನ ಮತ್ತು ಮುಂದಿನ ಬದಲಾವಣೆಗಳಿಗಾಗಿ ಒಳಗೆ ಸಾಕಷ್ಟು ಸೀಮ್ ಅಲೋವನ್ಸ್ ಬಿಟ್ಟಿರಬೇಕು."
        }
      },
      {
        "sr": 41,
        "label": {
          "en": "Stitch lines straight",
          "hi": "सिलाई की लाइनें सीधी हैं",
          "kn": "ಹೊಲಿಗೆ ರೇಖೆಗಳು ನೇರವಾಗಿವೆ"
        },
        "description": {
          "en": "All visible stitch lines should be straight and even, never wavy.",
          "hi": "सभी दिखने वाली सिलाई लाइनें सीधी और एक समान हों, कहीं लहराती न हों।",
          "kn": "ಕಾಣುವ ಎಲ್ಲಾ ಹೊಲಿಗೆ ರೇಖೆಗಳು ನೇರ ಮತ್ತು ಸಮವಾಗಿರಬೇಕು; ಅಂಕುಡೊಂಕಾಗಿರಬಾರದು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "I. FINISHING",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 42,
        "label": {
          "en": "Loose threads removed",
          "hi": "ढीले धागे हटाए गए हैं",
          "kn": "ಸಡಿಲ ದಾರಗಳನ್ನು ತೆಗೆದುಹಾಕಲಾಗಿದೆ"
        },
        "description": {
          "en": "Trim all loose and hanging threads inside and outside the garment.",
          "hi": "गारमेंट के अंदर और बाहर सभी ढीले व लटकते धागे काट दिए गए हों।",
          "kn": "ಉಡುಪಿನ ಒಳಗೆ ಮತ್ತು ಹೊರಗೆ ಎಲ್ಲಾ ಸಡಿಲ ಮತ್ತು ನೇತಾಡುವ ದಾರಗಳನ್ನು ಕತ್ತರಿಸಿರಬೇಕು."
        }
      },
      {
        "sr": 43,
        "label": {
          "en": "Chalk marks removed",
          "hi": "चॉक के निशान हटाए गए हैं",
          "kn": "ಚಾಕ್ ಗುರುತುಗಳನ್ನು ತೆಗೆದುಹಾಕಲಾಗಿದೆ"
        },
        "description": {
          "en": "All tailoring chalk or marking lines should be cleaned off completely.",
          "hi": "दर्ज़ी की चॉक या मार्किंग की सभी लकीरें पूरी तरह साफ़ हो गई हों।",
          "kn": "ಟೈಲರಿಂಗ್ ಚಾಕ್ ಅಥವಾ ಮಾರ್ಕಿಂಗ್ ಗೆರೆಗಳು ಸಂಪೂರ್ಣವಾಗಿ ಸ್ವಚ್ಛವಾಗಿರಬೇಕು."
        }
      },
      {
        "sr": 44,
        "label": {
          "en": "Garment steam pressed",
          "hi": "गारमेंट को स्टीम प्रेस किया गया है",
          "kn": "ಉಡುಪನ್ನು ಸ್ಟೀಮ್ ಪ್ರೆಸ್ ಮಾಡಲಾಗಿದೆ"
        },
        "description": {
          "en": "The finished blouse should be steam pressed so it looks crisp and wrinkle-free.",
          "hi": "तैयार ब्लाउज़ को स्टीम प्रेस किया गया हो ताकि वह साफ़ और बिना सिलवटों का दिखे।",
          "kn": "ಸಿದ್ಧ ಬ್ಲೌಸ್ ಅನ್ನು ಸ್ಟೀಮ್ ಪ್ರೆಸ್ ಮಾಡಿರಬೇಕು; ಅದು ಸುಕ್ಕುರಹಿತವಾಗಿ ಅಚ್ಚುಕಟ್ಟಾಗಿ ಕಾಣಬೇಕು."
        }
      },
      {
        "sr": 45,
        "label": {
          "en": "No stains",
          "hi": "कोई दाग़ नहीं है",
          "kn": "ಯಾವುದೇ ಕಲೆಗಳಿಲ್ಲ"
        },
        "description": {
          "en": "Check the entire garment in good light for any stains or dirt marks.",
          "hi": "अच्छी रोशनी में पूरे गारमेंट को देखें कि कहीं दाग़ या गंदगी का निशान न हो।",
          "kn": "ಒಳ್ಳೆಯ ಬೆಳಕಿನಲ್ಲಿ ಇಡೀ ಉಡುಪನ್ನು ಪರಿಶೀಲಿಸಿ — ಯಾವುದೇ ಕಲೆ ಅಥವಾ ಕೊಳೆ ಇರಬಾರದು."
        }
      },
      {
        "sr": 46,
        "label": {
          "en": "No oil marks",
          "hi": "तेल के निशान नहीं हैं",
          "kn": "ಎಣ್ಣೆ ಗುರುತುಗಳಿಲ್ಲ"
        },
        "description": {
          "en": "Look for machine oil marks, especially near seams and stitch lines.",
          "hi": "ख़ासकर सीम और सिलाई लाइनों के पास मशीन के तेल के निशान देखें।",
          "kn": "ವಿಶೇಷವಾಗಿ ಸೀಮ್ ಮತ್ತು ಹೊಲಿಗೆ ರೇಖೆಗಳ ಬಳಿ ಮಶೀನ್ ಎಣ್ಣೆ ಗುರುತುಗಳಿವೆಯೇ ಎಂದು ನೋಡಿ."
        }
      },
      {
        "sr": 47,
        "label": {
          "en": "No needle holes visible",
          "hi": "सुई के छेद दिखाई नहीं देते",
          "kn": "ಸೂಜಿ ರಂಧ್ರಗಳು ಕಾಣುವುದಿಲ್ಲ"
        },
        "description": {
          "en": "There should be no visible needle holes from unpicked or re-done stitching.",
          "hi": "उधेड़ी या दोबारा की गई सिलाई से सुई के छेद नहीं दिखने चाहिए।",
          "kn": "ಬಿಚ್ಚಿ ಮತ್ತೆ ಹೊಲಿದ ಜಾಗದಲ್ಲಿ ಸೂಜಿ ರಂಧ್ರಗಳು ಕಾಣಬಾರದು."
        }
      },
      {
        "sr": 48,
        "label": {
          "en": "No fabric damage",
          "hi": "कपड़े में कोई नुकसान नहीं है",
          "kn": "ಬಟ್ಟೆಗೆ ಯಾವುದೇ ಹಾನಿ ಇಲ್ಲ"
        },
        "description": {
          "en": "Check for cuts, tears, pulls or weave damage anywhere on the fabric.",
          "hi": "कपड़े पर कहीं भी कट, फटन, धागे का खिंचाव या बुनाई का नुकसान न हो।",
          "kn": "ಬಟ್ಟೆಯ ಮೇಲೆ ಎಲ್ಲಿಯೂ ಕಟ್, ಹರಿತ, ಎಳೆತ ಅಥವಾ ನೇಯ್ಗೆ ಹಾನಿ ಇರಬಾರದು."
        }
      }
    ]
  },
  {
    "title": {
      "en": "J. DESIGN VERIFICATION",
      "hi": "",
      "kn": ""
    },
    "items": [
      {
        "sr": 49,
        "label": {
          "en": "Front matches approved design",
          "hi": "फ्रंट स्वीकृत डिज़ाइन से मेल खाता है",
          "kn": "ಮುಂಭಾಗ ಅನುಮೋದಿತ ವಿನ್ಯಾಸಕ್ಕೆ ಹೊಂದುತ್ತದೆ"
        },
        "description": {
          "en": "Compare the front of the blouse with the approved design image — cut, style and details should match.",
          "hi": "ब्लाउज़ के फ्रंट की तुलना स्वीकृत डिज़ाइन इमेज से करें — कट, स्टाइल और डिटेल मेल खाने चाहिए।",
          "kn": "ಬ್ಲೌಸ್‌ನ ಮುಂಭಾಗವನ್ನು ಅನುಮೋದಿತ ವಿನ್ಯಾಸ ಚಿತ್ರದೊಂದಿಗೆ ಹೋಲಿಸಿ — ಕಟ್, ಸ್ಟೈಲ್ ಮತ್ತು ವಿವರಗಳು ಹೊಂದಬೇಕು."
        }
      },
      {
        "sr": 50,
        "label": {
          "en": "Back matches approved design",
          "hi": "बैक स्वीकृत डिज़ाइन से मेल खाता है",
          "kn": "ಹಿಂಭಾಗ ಅನುಮೋದಿತ ವಿನ್ಯಾಸಕ್ಕೆ ಹೊಂದುತ್ತದೆ"
        },
        "description": {
          "en": "Compare the back — neck depth, dori/closure style and details should match the approved design.",
          "hi": "बैक की तुलना करें — गले की गहराई, डोरी/क्लोज़र स्टाइल और डिटेल स्वीकृत डिज़ाइन से मेल खाने चाहिए।",
          "kn": "ಹಿಂಭಾಗವನ್ನು ಹೋಲಿಸಿ — ಕುತ್ತಿಗೆಯ ಆಳ, ಡೋರಿ/ಕ್ಲೋಶರ್ ಸ್ಟೈಲ್ ಮತ್ತು ವಿವರಗಳು ಅನುಮೋದಿತ ವಿನ್ಯಾಸಕ್ಕೆ ಹೊಂದಬೇಕು."
        }
      },
      {
        "sr": 51,
        "label": {
          "en": "Sleeve design matches",
          "hi": "आस्तीन का डिज़ाइन मेल खाता है",
          "kn": "ತೋಳಿನ ವಿನ್ಯಾಸ ಹೊಂದುತ್ತದೆ"
        },
        "description": {
          "en": "Sleeve length, style and detailing should match the approved design.",
          "hi": "आस्तीन की लंबाई, स्टाइल और डिटेलिंग स्वीकृत डिज़ाइन से मेल खानी चाहिए।",
          "kn": "ತೋಳಿನ ಉದ್ದ, ಸ್ಟೈಲ್ ಮತ್ತು ವಿವರಗಳು ಅನುಮೋದಿತ ವಿನ್ಯಾಸಕ್ಕೆ ಹೊಂದಬೇಕು."
        }
      },
      {
        "sr": 52,
        "label": {
          "en": "Neck design matches",
          "hi": "गले का डिज़ाइन मेल खाता है",
          "kn": "ಕುತ್ತಿಗೆಯ ವಿನ್ಯಾಸ ಹೊಂದುತ್ತದೆ"
        },
        "description": {
          "en": "Front and back neck designs should match the approved design exactly.",
          "hi": "फ्रंट और बैक नेक डिज़ाइन स्वीकृत डिज़ाइन से बिल्कुल मेल खाने चाहिए।",
          "kn": "ಮುಂಭಾಗ ಮತ್ತು ಹಿಂಭಾಗದ ನೆಕ್ ವಿನ್ಯಾಸಗಳು ಅನುಮೋದಿತ ವಿನ್ಯಾಸಕ್ಕೆ ನಿಖರವಾಗಿ ಹೊಂದಬೇಕು."
        }
      },
      {
        "sr": 53,
        "label": {
          "en": "Embellishments correctly placed",
          "hi": "सजावट (एम्बेलिशमेंट) सही जगह पर लगी है",
          "kn": "ಅಲಂಕಾರಗಳನ್ನು ಸರಿಯಾದ ಸ್ಥಳದಲ್ಲಿ ಇರಿಸಲಾಗಿದೆ"
        },
        "description": {
          "en": "All embellishments (stones, beads, embroidery, etc.) should be in the exact positions shown in the design.",
          "hi": "सभी सजावट (स्टोन, मोती, कढ़ाई आदि) डिज़ाइन में दिखाई गई सही जगहों पर होनी चाहिए।",
          "kn": "ಎಲ್ಲಾ ಅಲಂಕಾರಗಳು (ಕಲ್ಲು, ಮಣಿ, ಕಸೂತಿ ಇತ್ಯಾದಿ) ವಿನ್ಯಾಸದಲ್ಲಿ ತೋರಿಸಿರುವ ನಿಖರ ಸ್ಥಳಗಳಲ್ಲಿರಬೇಕು."
        }
      }
    ]
  }
];

export const QC_ITEM_COUNT = 53;
