function app() {
    return {

        /* ============================================================
         *  ÉTAT
         * ========================================================== */
        viewList: false,
        loading: true,
        pdv: {},

        producteurs: [],
        masterMin: 10,

        // Gestion du blocage master/partenaires
        pendingMasterChange: null,     // { p, oldQty, newQty }
        partnersToRemove: [],          // liste des produits partenaires à vider

        // Modal
        modalEl: null,
        bsModal: null,

        // Sauvegarde des quantités avant modification
        backupQuantities: {},


        /* ============================================================
         *  SAUVEGARDE / RESTAURATION QUANTITÉS
         * ========================================================== */
        saveQuantities() {
            this.backupQuantities = {};

            this.producteurs.forEach(prod => {
                prod.products.forEach(p => {
                    this.backupQuantities[p.product_id] = p.qty;
                });
            });
        },

        restoreQuantities() {
            this.producteurs.forEach(prod => {
                prod.products.forEach(p => {
                    if (this.backupQuantities[p.product_id] !== undefined) {
                        p.qty = this.backupQuantities[p.product_id];
                    }
                });
            });

            // restore master product qty
            this.pendingMasterChange.p.qty = this.pendingMasterChange.oldQty;
        },


        /* ============================================================
         *  CHECK DU MASTER / PARTENAIRES
         * ========================================================== */
        checkMasterChange(prod, p, newQty) {

            const oldQty = p.qty;
            this.pendingMasterChange = { p, oldQty, newQty };

            // appliquer la nouvelle valeur temporairement
            p.qty = newQty;

            // détecter si un partenaire a qty > 0
            const hasPartnerProduct =
                this.producteurs
                    .filter(pr => pr.config.master !== "oui")
                    .some(pr => pr.products.some(prod => prod.qty > 0));

            // si master < min et partenaires actifs → alerte
            if (this.masterTotal < this.masterMin && hasPartnerProduct) {

                // liste des partenaires concernés
                this.partnersToRemove = [];
                this.producteurs.forEach(pr => {
                    if (pr.config.master !== "oui" && pr.config.expéparmaster) {
                        this.partnersToRemove.push(
                            ...pr.products.filter(prod => prod.qty > 0)
                        );
                    }
                });

                if (this.partnersToRemove.length > 0) {
                    this.saveQuantities();

                    this.modalEl = document.getElementById('alertModal');
                    this.bsModal = new bootstrap.Modal(this.modalEl, {
                        backdrop: 'static',
                        keyboard: false
                    });

                    this.bsModal.show();
                    return;
                }
            }
        },


        /* ============================================================
         *  CONFIRMATION / ANNULATION PARTENAIRES
         * ========================================================== */
        confirmPartnerRemoval() {
            // mettre qty à zéro pour tous les partenaires concernés
            this.partnersToRemove.forEach(p => p.qty = 0);
            this.partnersToRemove = [];

            this.bsModal.hide();
        },

        cancelPartnerRemoval() {
            // restaurer master + partenaires
            this.restoreQuantities();
            this.partnersToRemove = [];

            this.bsModal.hide();
        },


        /* ============================================================
         *  CALCULS / UTILITAIRES
         * ========================================================== */
        
        get totalClass() {
            const master = this.producteurs.find(p => p.config.master === 'oui');
            const masterTotal = this.masterTotal;
            
            // Rouge si master non atteint
            if (master && masterTotal < master.config.minCommande) return 'text-danger';
            
            // Orange si un partenaire non atteint et a déjà une quantité > 0
            if (this.producteurs.some(p => p.config.master !== 'oui' && this.totalPartner(p) < p.config.minCommande && this.totalPartner(p) > 0)) {
                return 'text-warning';
            }
        
            // Vert sinon
            return 'text-success';
        },
        
        get totalReason() {
            const master = this.producteurs.find(p => p.config.master === 'oui');
            if (master && this.masterTotal < master.config.minCommande) return `Minimum de commande master : ${master.config.minCommande}€ non atteint`;
            let partner = this.producteurs.find(p => p.config.master !== 'oui' && this.totalPartner(p) < p.config.minCommande && this.totalPartner(p)>0);
            if (partner) return `Minimum de commande partenaire : ${partner.config.minCommande}€ requis chez ${partner.config.nom}`;
            return 'Tous les minimums de commande sont atteints';
        },
        
        get total() {
            // Calcul total panier : master + partenaires
            let totalMaster = this.masterTotal;
            let totalPartners = this.producteurs
                .filter(p => p.config.master !== 'oui')
                .reduce((sum, p) => sum + this.totalPartner(p), 0);
            return totalMaster + totalPartners;
        },
        
        get masterTotal() {
            const master = this.producteurs.find(p => p.config.master === "oui");
            if (!master) return 0;

            return master.products.reduce(
                (sum, prod) => sum + (prod.qty * prod.prix_unitaire), 0
            );
        },
        totalPartner(prod) {
            return prod.products.reduce((sum, p) => sum + (p.qty * p.prix_unitaire), 0);
        },
        totalQty() { 
        return this.producteurs.reduce((total, prod) => total + prod.products.reduce((sum, p) => sum + p.qty, 0), 0);
        },

        showPartnerToast() {
            const toastEl = document.getElementById("partnerToast");
            const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
            toast.show();

            if (navigator.vibrate) navigator.vibrate(120);
        },

        formatDate(date) {
            const d = new Date(date);
            return this.ucfirst(
                d.toLocaleDateString('fr-FR', {
                    weekday: 'long', day: 'numeric', month: 'long',
                    hour: '2-digit', minute: '2-digit'
                })
            );
        },

        ucfirst(str) {
            return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
        },


        /* ============================================================
         *  CHARGEMENT DES PRODUCTEURS
         * ========================================================== */
        async loadProducteurs() {
            const spinner = document.getElementById('spinner-overlay');
            spinner.classList.remove('hidden');

            try {
                console.log("FETCH catalogue…");

                const scriptURL =
                    "https://script.google.com/macros/s/AKfycbwIKXZPnoT21L6RZU5BYLNdoYXSf-TyF9M_nyga_h_amgGaMBxSl69hxr0LZ4YlXSc7bQ/exec";
                const retrait = new URLSearchParams(window.location.search).get('retrait');

                const res = await fetch(`${scriptURL}?action=commande&retrait=${retrait}`);
                const json = await res.json();

                this.pdv = json.pdv || {};

                this.producteurs = (json.catalogue || []).map(prod => {
                    prod.products = prod.products || [];
                    prod.products.forEach(p => p.qty = 0);
                    prod.hasAlcohol = prod.products.some(p => p.alcool?.toLowerCase() === "oui");
                    return prod;
                });

            } catch (error) {
                console.error("Erreur lors du chargement :", error);
            } finally {
                this.loading = false;
            }
        },


        /* ============================================================
         *  INITIALISATION
         * ========================================================== */
        init() {
            console.log("Initialisation AlpineJS");
            this.loadProducteurs();
        },
        
         /* ============================================================
         *  CHECKOUT
         * ========================================================== */
        
         checkout() {
            if (!this.formValid || this.totalClass !== 'text-success'){
                alert('PB VALIDATION');
                return false;
            }
            alert('Commande envoyée !');
            cart = [];
    
        }
}
}
