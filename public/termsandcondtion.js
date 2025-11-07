
/**
 * @param {HTMLElement} popupEl 
 */
function openPopup(popupEl) {
    if (!popupEl) return;
    popupEl.style.display = 'flex';

    const outsideClickHandler = (e) => {
        if (e.target === popupEl) closePopup(popupEl);
    };
    popupEl.addEventListener('click', outsideClickHandler);

    const closeBtn = popupEl.querySelector('.close, .close-cart, .close-terms, .close-reviews, .close-btn');
    if (closeBtn) {
        closeBtn.onclick = () => closePopup(popupEl);
    }

    popupEl._outsideClickHandler = outsideClickHandler;
}

/**
 * @param {HTMLElement} popupEl 
 */
function closePopup(popupEl) {
    if (!popupEl) return;
    popupEl.style.display = 'none';
    if (popupEl._outsideClickHandler) {
        popupEl.removeEventListener('click', popupEl._outsideClickHandler);
        popupEl._outsideClickHandler = null;
    }
}


const termsPopup = document.getElementById('termsPopup');

if (termsPopup) {
    const closeTerms = termsPopup.querySelector('.close-terms');
    if (closeTerms) {
        closeTerms.addEventListener('click', () => closePopup(termsPopup));
    }
}

export function showTermsPopup() {
    if (termsPopup) {
        openPopup(termsPopup);
    }
}
