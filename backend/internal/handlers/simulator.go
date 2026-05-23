package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/dagviz/backend/internal/db"
	"github.com/dagviz/backend/internal/models"
	ws "github.com/dagviz/backend/internal/websocket"
)

type Simulator struct {
	db       *db.DB
	hub      *ws.Hub
	domain   string
	domainID string
	interval time.Duration
}

func NewSimulator(database *db.DB, hub *ws.Hub, domain string, intervalMs int) *Simulator {
	return &Simulator{
		db:       database,
		hub:      hub,
		domain:   domain,
		interval: time.Duration(intervalMs) * time.Millisecond,
	}
}

var launderingNodeTypes = []struct {
	typeName string
	labels   []string
	country  []string
	baseRisk float64
}{
	{"shell_company", []string{
		"Nexus Holdings BVI", "Pinnacle Ventures Ltd", "Azure Capital Group",
		"Meridian Assets Corp", "Sovereign Wealth LLC", "Pacific Rim Enterprises",
		"Atlantis Global Trust", "Northern Star Investments", "Silver Creek Capital",
		"Cayman Bridge Holdings", "Eclipse Trading Co", "Phantom Assets Ltd",
		"Mirage Financial Corp", "Ghost Capital Partners", "Shadow Ledger Inc",
	}, []string{"BVI", "Cayman Islands", "Panama", "Seychelles", "Luxembourg", "Malta"}, 0.7},
	{"bank_account", []string{
		"Deutsche Bank #9923", "HSBC Offshore #4471", "UBS Geneva #0012",
		"Credit Suisse #8834", "Standard Chartered #2291", "Barclays Isle of Man #5512",
		"Citi Private #9901", "Julius Baer #3345", "Liechtenstein Global Trust",
		"Andorra Banc Agricol", "Bank of Malta #7732", "Valletta Fund Services",
	}, []string{"Switzerland", "UK", "Germany", "Malta", "Liechtenstein", "Andorra"}, 0.5},
	{"crypto_wallet", []string{
		"0x1a2b3c4d5e6f", "bc1q9h8g7f6e5d", "0x9f8e7d6c5b4a",
		"3FZbgi29cpjq2GjdwV8eyHuJJnkLtktZc5", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
		"0xdead00beef0011", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
		"0xcafe0123456789", "DdzFFzCqrht8d8A1jSBnLPnFBfRLgqPE1GN",
	}, []string{"Unknown", "Tor Network", "VPN", "Darknet"}, 0.85},
	{"individual", []string{
		"Viktor Volkov", "Chen Wei", "Mohammed Al-Rashid", "Carlos Mendoza",
		"Natasha Petrov", "Ahmad Karimi", "Isabella Fontaine", "Dmitri Sokolov",
		"Li Fang", "Roberto Escobar Jr", "Olena Marchenko", "Hassan Bakr",
		"Elena Volkov", "Javier Santos", "Yuki Tanaka",
	}, []string{"Russia", "China", "UAE", "Colombia", "Ukraine", "Iran", "Italy"}, 0.6},
	{"real_estate", []string{
		"Mayfair Penthouse #42A", "Dubai Marina Tower 7", "Monaco Residences",
		"Manhattan Loft 88F", "Marbella Villa Costa", "Geneva Lakeside Estate",
		"Hong Kong Peak Mansion", "Miami Beach Condos", "Paris 16eme Apartment",
		"Singapore Orchard Tower", "Limassol Beachfront",
	}, []string{"UK", "UAE", "Monaco", "USA", "Spain", "Switzerland"}, 0.55},
	{"offshore_fund", []string{
		"Cayman Alpha Fund", "BVI Growth Portfolio", "Luxembourg SICAV-SIF",
		"Malta QIAIF", "Jersey Exempt Fund", "Guernsey Investment Trust",
		"Isle of Man Cell Company", "Bermuda Exempted LP",
	}, []string{"Cayman Islands", "BVI", "Luxembourg", "Malta", "Jersey", "Guernsey"}, 0.75},
}

var edgeTypes = []struct {
	label  string
	weight float64
}{
	{"wire_transfer", 250000},
	{"crypto_swap", 85000},
	{"cash_deposit", 9500},
	{"loan_repayment", 120000},
	{"investment", 500000},
	{"dividend_payment", 75000},
	{"real_estate_purchase", 2500000},
	{"shell_transfer", 1000000},
	{"hawala", 45000},
	{"smurfing", 8900},
}

var alertRules = []struct {
	rule     string
	desc     string
	severity string
	minRisk  float64
}{
	{"STRUCTURING", "Multiple transactions just below reporting threshold (smurfing)", "high", 0.7},
	{"LAYERING", "Rapid fund movement through multiple jurisdictions", "critical", 0.8},
	{"HIGH_RISK_JURISDICTION", "Transaction involves FATF blacklisted country", "high", 0.65},
	{"CRYPTO_MIXING", "Funds passed through known crypto mixer", "critical", 0.85},
	{"RAPID_MOVEMENT", "Funds moved within 24h of receipt", "medium", 0.5},
	{"SHELL_CHAIN", "3+ shell companies in transaction chain", "high", 0.75},
	{"SANCTIONS_MATCH", "Entity matches OFAC sanctions list", "critical", 0.9},
	{"PEP_INVOLVEMENT", "Politically Exposed Person involved", "high", 0.7},
}

func (s *Simulator) Start(ctx context.Context) {
	// Bootstrap domain ID
	var err error
	s.domainID, err = s.db.GetDomainID(ctx, s.domain)
	if err != nil {
		log.Printf("Simulator: failed to get domain ID: %v", err)
		return
	}

	// Seed initial data if empty
	if count := s.db.NodeCount(ctx, s.domainID); count < 20 {
		log.Println("Simulator: seeding initial graph...")
		s.seedInitial(ctx)
	}

	log.Printf("Simulator: starting %s domain, tick every %v", s.domain, s.interval)
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Simulator) seedInitial(ctx context.Context) {
	r := rand.New(rand.NewSource(42))

	nodeIDs := []string{}
	for _, nt := range launderingNodeTypes {
		count := 3 + r.Intn(4)
		for i := 0; i < count; i++ {
			label := nt.labels[r.Intn(len(nt.labels))]
			country := nt.country[r.Intn(len(nt.country))]
			riskJitter := (r.Float64() - 0.5) * 0.3
			risk := clamp(nt.baseRisk+riskJitter, 0.1, 1.0)
			meta := map[string]interface{}{
				"jurisdiction": country,
				"registered":   randomDate(r, 2015, 2023),
				"volume_usd":   r.Intn(10000000),
			}
			metaJSON, _ := json.Marshal(meta)
			node := &models.Node{
				DomainID:  s.domainID,
				TypeName:  nt.typeName,
				Label:     label,
				RiskScore: risk,
				Country:   country,
				Metadata:  json.RawMessage(metaJSON),
			}
			if err := s.db.InsertNode(ctx, node); err == nil {
				nodeIDs = append(nodeIDs, node.ID)
			}
		}
	}

	// Create initial edges
	nodes, _ := s.db.GetRandomNodes(ctx, s.domainID, 40)
	for i := 0; i < 45 && i < len(nodes)-1; i++ {
		src := nodes[r.Intn(len(nodes))]
		tgt := nodes[r.Intn(len(nodes))]
		if src.ID == tgt.ID {
			continue
		}
		et := edgeTypes[r.Intn(len(edgeTypes))]
		weight := et.weight * (0.5 + r.Float64())
		meta := map[string]interface{}{
			"amount_usd":  fmt.Sprintf("%.2f", weight),
			"date":        randomDate(r, 2023, 2024),
			"flagged":     weight > 500000,
			"swift_code":  randomSwift(r),
		}
		metaJSON, _ := json.Marshal(meta)
		edge := &models.Edge{
			DomainID: s.domainID,
			SourceID: src.ID,
			TargetID: tgt.ID,
			Label:    et.label,
			Weight:   weight,
			Metadata: json.RawMessage(metaJSON),
		}
		s.db.InsertEdge(ctx, edge)
	}

	// Create initial alerts
	nodes, _ = s.db.GetRandomNodes(ctx, s.domainID, 20)
	for _, n := range nodes {
		if n.RiskScore > 0.65 && r.Float64() > 0.4 {
			rule := alertRules[r.Intn(len(alertRules))]
			s.db.InsertAlert(ctx, &models.Alert{
				DomainID:    s.domainID,
				NodeID:      n.ID,
				Severity:    rule.severity,
				RuleName:    rule.rule,
				Description: rule.desc,
			})
		}
	}
}

func (s *Simulator) tick(ctx context.Context) {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	roll := r.Float64()

	switch {
	case roll < 0.35:
		// Add a new node
		nt := launderingNodeTypes[r.Intn(len(launderingNodeTypes))]
		label := nt.labels[r.Intn(len(nt.labels))]
		country := nt.country[r.Intn(len(nt.country))]
		risk := clamp(nt.baseRisk+(r.Float64()-0.5)*0.3, 0.05, 1.0)
		meta := map[string]interface{}{
			"jurisdiction": country,
			"registered":   time.Now().Format("2006-01-02"),
			"volume_usd":   r.Intn(5000000),
			"flagged_new":  true,
		}
		metaJSON, _ := json.Marshal(meta)
		node := &models.Node{
			DomainID:  s.domainID,
			TypeName:  nt.typeName,
			Label:     label,
			RiskScore: risk,
			Country:   country,
			Metadata:  json.RawMessage(metaJSON),
		}
		if err := s.db.InsertNode(ctx, node); err == nil {
			s.hub.Broadcast("node_added", node)
		}

	case roll < 0.70:
		// Add a new edge between existing nodes
		nodes, err := s.db.GetRandomNodes(ctx, s.domainID, 10)
		if err != nil || len(nodes) < 2 {
			return
		}
		src := nodes[r.Intn(len(nodes))]
		tgt := nodes[r.Intn(len(nodes))]
		if src.ID == tgt.ID {
			return
		}
		et := edgeTypes[r.Intn(len(edgeTypes))]
		weight := et.weight * (0.3 + r.Float64()*2)
		meta := map[string]interface{}{
			"amount_usd": fmt.Sprintf("%.2f", weight),
			"date":       time.Now().Format("2006-01-02"),
			"flagged":    weight > 500000,
			"swift_code": randomSwift(r),
			"live":       true,
		}
		metaJSON, _ := json.Marshal(meta)
		edge := &models.Edge{
			DomainID: s.domainID,
			SourceID: src.ID,
			TargetID: tgt.ID,
			Label:    et.label,
			Weight:   weight,
			Metadata: json.RawMessage(metaJSON),
		}
		if err := s.db.InsertEdge(ctx, edge); err == nil {
			s.hub.Broadcast("edge_added", edge)
		}

	case roll < 0.85:
		// Fire an alert
		nodes, err := s.db.GetRandomNodes(ctx, s.domainID, 5)
		if err != nil || len(nodes) == 0 {
			return
		}
		n := nodes[r.Intn(len(nodes))]
		rule := alertRules[r.Intn(len(alertRules))]
		if n.RiskScore >= rule.minRisk {
			alert := &models.Alert{
				DomainID:    s.domainID,
				NodeID:      n.ID,
				NodeLabel:   n.Label,
				Severity:    rule.severity,
				RuleName:    rule.rule,
				Description: rule.desc,
			}
			s.db.InsertAlert(ctx, alert)
			s.hub.Broadcast("alert", alert)
		}

	default:
		// Stats pulse
		s.hub.Broadcast("stats", map[string]interface{}{
			"nodes":     s.db.NodeCount(ctx, s.domainID),
			"timestamp": time.Now().Unix(),
		})
	}
}

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func randomDate(r *rand.Rand, startY, endY int) string {
	y := startY + r.Intn(endY-startY+1)
	m := 1 + r.Intn(12)
	d := 1 + r.Intn(28)
	return fmt.Sprintf("%04d-%02d-%02d", y, m, d)
}

func randomSwift(r *rand.Rand) string {
	banks := []string{"DEUTDEDB", "HSBCHKHH", "UBSWCHZH", "CRESCHZZ", "SCBLHKHH", "BARCGB22"}
	return banks[r.Intn(len(banks))]
}
