The portal should support several connected workspaces:

1. Company operations
2. Sales and preconstruction
3. Active project management
4. Financial management
5. Client portal
6. Vendor/subcontractor portal
7. Investor/spec-home reporting
8. Warranty and post-construction
9. Company analytics and document retention

Each person should see a different version of the same underlying project data based on their role.

## 1. Company dashboard

Your opening admin screen should answer: “What needs my attention today?”

Include:

* All active projects
* Projects at risk
* Upcoming inspections
* Overdue selections
* Unapproved change orders
* Outstanding proposals
* Bills awaiting review
* Draws ready to issue
* Past-due client balances
* Expiring insurance certificates
* Subcontractors missing agreements or W-9s
* Schedule delays
* Budget overruns
* Unanswered client messages
* Contracts awaiting signature
* Warranty requests
* Recent project activity
* Company cash-flow forecast
* Projects needing daily logs or updates

You should be able to click any alert and go directly to the item needing action.

## 2. Leads, sales, and preconstruction

The portal should start before a client becomes a client.

### Lead tracking

* Add leads manually
* Website inquiry intake
* Lead source tracking
* Contact information
* Project type
* Approximate budget
* Desired location
* Desired start date
* Lot ownership status
* Financing status
* Notes and communication history
* Sales stage
* Follow-up reminders
* Probability of closing
* Lost-lead reasons

Suggested stages:

* New inquiry
* Initial contact
* Discovery call
* Site visit
* Feasibility
* Preconstruction proposal
* Estimating
* Contract negotiation
* Won
* Lost
* On hold

### Preconstruction

* Site evaluation checklist
* Feasibility notes
* Preliminary budget
* Allowance assumptions
* Architect/design contacts
* Surveys and reports
* Preliminary schedule
* Design milestones
* Permit requirements
* Utilities and site constraints
* Preconstruction agreement
* Retainer invoice
* Client questionnaire
* Inspiration images
* Plan versions
* Proposal comparisons
* Internal go/no-go decision

A lead should convert into a project without re-entering all the information.

## 3. Project creation and setup

“New Project” needs to be one of the most obvious admin actions.

The project wizard should capture:

* Project name
* Internal job number
* Client/company
* Project type
* Cost-plus, fixed-price, spec, service, or preconstruction
* Project address
* Contract date
* Planned start and completion
* Original contract amount
* Builder fee structure
* Deposit or retainer
* Client contacts
* Internal team
* Architect/designer
* Lender
* Investor/ownership group
* Project visibility
* File-storage location
* Accounting/job-cost mapping
* Default budget template
* Default schedule template
* Required documents
* Client invitation settings

Useful project templates:

* Custom home
* Major renovation
* Addition
* Basement finish
* Pool cabana/outdoor living
* Light commercial
* Spec home
* Warranty/service project

## 4. Budgeting and estimating

This should become one of the portal’s strongest areas because it directly supports your cost-plus model.

### Estimate builder

* Budget categories and cost codes
* Detailed line items
* Quantities, units, labor, material, and subcontract amounts
* Allowances
* Alternates
* Contingency
* Builder fee
* Tax and permit costs
* Internal notes
* Client descriptions
* Vendor quote attachments
* Estimate versions
* Estimate approval
* Estimate-to-contract conversion
* Printable branded estimates

### Live project budget

Track separately:

* Original estimate
* Approved budget
* Revised budget
* Committed costs
* Actual costs
* Pending costs
* Approved change orders
* Pending change orders
* Forecast to complete
* Projected final cost
* Variance
* Client-billable amount
* Non-billable/internal cost
* Builder fee earned
* Builder fee billed
* Retainage
* Amount paid
* Remaining client balance

Every budget number should be traceable to its source.

### Budget revision controls

* Require a reason for revisions
* Preserve the original estimate
* Version history
* Who changed it
* Date and time
* Client-visible versus internal notes
* Approval thresholds
* Locked accounting periods
* Audit trail

## 5. QuickBooks and job-cost workflow

Since you use QuickBooks Desktop Enterprise, the portal should initially use controlled imports rather than promise a seamless real-time integration that may be unreliable.

Include:

* Upload QuickBooks job-cost report
* Map QuickBooks items/accounts to portal cost codes
* Save mapping rules
* Detect duplicate transactions
* Preview changes before import
* Flag uncategorized expenses
* Identify costs missing vendor names
* Identify possible personal or unrelated charges
* Match bills to purchase orders and commitments
* Reconcile portal totals to QuickBooks
* Show the last successful import
* Preserve the source report
* Reverse an incorrect import safely
* Lock finalized reporting periods

Eventually, investigate a Windows-based connector for QuickBooks Desktop, but design the portal so CSV/Excel imports remain a dependable fallback.

## 6. Client billing and progress draws

The system should turn imported job costs into professional billing.

### Draw creation

* Select a billing period
* Pull unbilled costs
* Review every cost before including it
* Add builder fee
* Apply markup rules
* Add reimbursable expenses
* Include approved change orders
* Apply deposits or credits
* Hold disputed costs
* Add retainage
* Create a draw summary
* Attach receipts and invoices
* Add client-facing explanations
* Internal review and approval
* Publish to client
* Generate branded PDF
* Email payment link
* Record ACH/check/card payment
* Partial-payment handling
* Past-due reminders

### Cost-plus transparency

For each billed item, control whether the client sees:

* Vendor name
* Internal cost
* Receipt/invoice
* Description
* Builder fee
* Markup
* Cost code
* Payment status
* Internal notes

Not every internal accounting field should be exposed merely because the client can see the project budget.

## 7. Commitments, purchase orders, and subcontracts

Before a cost becomes an invoice, you need to know what has already been committed.

Include:

* Vendor proposals
* Bid comparison
* Scope sheets
* Purchase orders
* Subcontracts
* Work authorizations
* Committed amount
* Change directives
* Approved subcontract changes
* Amount billed
* Remaining commitment
* Retainage
* Payment status
* Lien waiver status
* COI status
* W-9 status
* Contract signature status
* Required closeout documents

This prevents a project from appearing under budget simply because the vendor has not invoiced yet.

## 8. Vendor and subcontractor portal

Each subcontractor should have a simple, mobile-friendly workspace.

They should be able to:

* View assigned projects
* View relevant plans and specifications
* See requested bid opportunities
* Submit proposals
* Ask scope questions
* Accept work orders
* Sign subcontract agreements
* Upload W-9s
* Upload certificates of insurance
* Receive expiration reminders
* View scheduled dates
* Confirm availability
* Upload invoices
* Submit change requests
* Upload progress photos
* Complete safety or site requirements
* Submit lien waivers
* View payment status
* Provide warranty information
* Respond to punch-list items

They should only see information relevant to their work—not the overall project’s finances or other vendors’ pricing.

### Vendor directory

Maintain:

* Trades performed
* Service area
* Primary contacts
* Pricing notes
* Insurance expiration
* License information
* Tax documentation
* Performance ratings
* Quality notes
* Schedule reliability
* Communication rating
* Safety issues
* Projects completed
* Current workload
* Preferred or inactive status
* Do-not-use status with restricted internal notes

## 9. Bid management

A bid package should allow you to:

* Select scope/cost code
* Create a consistent bid form
* Attach current plans
* Invite several vendors
* Track who opened it
* Record questions and addenda
* Receive bids
* Normalize exclusions and allowances
* Compare bids side by side
* Identify scope gaps
* Select winning bid
* Convert bid to commitment or subcontract
* Notify unsuccessful bidders professionally

This would be valuable during both estimating and active construction.

## 10. Scheduling

You need multiple connected schedule views:

* Master company schedule
* Project schedule
* Three-week look-ahead
* Vendor schedule
* Client milestone schedule
* Inspection calendar
* Selection deadline calendar
* Delivery schedule

Functions should include:

* Dependencies
* Baseline versus current schedule
* Critical milestones
* Assigned subcontractors
* Confirmation status
* Weather delays
* Inspection dependencies
* Material lead times
* Schedule changes
* Delay reasons
* Client-caused delays
* Vendor-caused delays
* Automatic notifications
* Calendar integration
* Mobile updates from the field

The client should see a simplified schedule, not every internal dependency or tentative date.

## 11. Daily field operations

A mobile field screen should make jobsite reporting fast.

Include:

* Daily log
* Weather
* Workers and companies on site
* Work completed
* Deliveries
* Inspections
* Delays
* Safety issues
* Visitors
* Photos and videos
* Voice-to-text notes
* Location/date stamping
* Items needing follow-up
* Tomorrow’s plan
* Private versus client-visible entries

Other field tools:

* Punch lists
* Quality-control checklists
* Inspection checklists
* Plan annotations
* RFI creation
* Issue tracking
* Task assignments
* Due dates
* Completion verification
* Before/after photos

## 12. Selections and allowances

Selections need to connect design decisions to the budget and schedule.

For each selection:

* Category
* Room/location
* Description
* Allowance
* Available options
* Vendor/showroom
* Photos
* Specifications
* Model/color/finish
* Pricing
* Tax and delivery
* Builder fee impact
* Lead time
* Required decision date
* Recommended option
* Client questions
* Approval
* Electronic acknowledgment
* Ordered status
* Delivery status
* Installation status
* Warranty information

The system should automatically show whether a choice is:

* Within allowance
* Over allowance
* Under allowance
* Schedule-critical
* Awaiting pricing
* Awaiting client approval
* Ordered
* Backordered
* Installed

Approved overages should flow into a change order or appropriate cost-plus billing treatment.

## 13. Change orders and field directives

Support several related but distinct records:

* Client-requested change
* Builder-recommended change
* Unforeseen-condition change
* Allowance overage
* Vendor change request
* Emergency field directive
* No-cost change
* Credit change order
* Time-only extension

Workflow:

1. Create request.
2. Document reason and scope.
3. Attach photos/plans.
4. Request vendor pricing.
5. Add labor, material, fee, and schedule impact.
6. Review internally.
7. Send to client.
8. Client approves, rejects, or asks a question.
9. Capture signature and date.
10. Update budget and schedule.
11. Issue revised scope to vendors.
12. Track invoicing and completion.

The portal should prevent work from quietly proceeding without documenting who authorized it—with an emergency override and audit trail for legitimate field situations.

## 14. Documents and electronic signatures

Document management should handle:

* Contracts
* Amendments
* Change orders
* Plans
* Specifications
* Engineering
* Surveys
* Permits
* Vendor proposals
* Invoices
* Receipts
* Insurance
* W-9s
* Lien waivers
* Inspection reports
* Product data
* Warranties
* Manuals
* Finish schedules
* Certificates of occupancy
* Closeout packages

Functions:

* Drag-and-drop upload
* Folder templates
* Tags
* Search
* OCR
* Document preview
* Version control
* Superseded-document warnings
* Permissions
* Expiration dates
* Signature status
* Download history
* Audit history
* OneDrive synchronization

For e-signatures, integrate an established provider such as DocuSign, Dropbox Sign, or Adobe Acrobat Sign rather than attempting to invent a legally reliable signature platform.

## 15. Plans, RFIs, and revisions

Important construction-document controls:

* Current plan set
* Previous revisions
* Revision date
* Addenda
* Sheet-level comparison
* RFI log
* RFI responsibility
* Due date
* Architect response
* Cost impact
* Schedule impact
* Related change order
* Distribution acknowledgment

A subcontractor should be clearly warned if they attempt to open or use an outdated drawing.

## 16. Client portal

Clients need a clean, curated experience.

Their home screen should show:

* Overall status
* Recent progress
* Featured project photos
* Upcoming milestones
* Decisions needed
* Selection deadlines
* Change orders awaiting approval
* Invoices due
* Budget summary
* Recent messages
* Documents awaiting signature
* Next meeting
* Builder updates

Clients should be able to:

* Review progress
* Approve selections
* Approve change orders
* Review and sign documents
* View invoices
* Make payments
* View approved budget information
* Upload inspiration or documents
* Ask questions
* Request meetings
* See contacts
* Download closeout documents
* Submit warranty requests

They should not see internal disputes, vendor performance notes, profit information, tentative pricing, private daily logs, or unapproved documents.

## 17. Communication center

Instead of important decisions being scattered through texts and emails, the portal should preserve project communication.

Include:

* Project conversations
* Direct messages
* Topic-based threads
* Email-to-project capture
* Mentions
* Attachments
* Read receipts where appropriate
* Client-visible/internal designation
* Decisions linked to messages
* Message-to-task conversion
* Message-to-RFI conversion
* Message-to-change-request conversion
* Searchable communication history
* Automated summaries

Do not try to eliminate email completely. Let the portal send and receive email while preserving the authoritative project record.

## 18. Meetings

* Schedule project meetings
* Agenda templates
* Attendees
* Meeting notes
* Voice transcription
* Decisions made
* Tasks assigned
* Due dates
* Client acknowledgment
* Recurring meeting structure
* Previous unresolved items

A weekly owner-contractor meeting could generate a clean PDF report automatically.

## 19. Investor and spec-home workspace

This is different from a client portal.

For spec homes or outside investors, provide:

* Property/entity information
* Ownership percentages
* Capital contributions
* Draw requests
* Sources and uses
* Original pro forma
* Current forecast
* Committed costs
* Actual costs
* Projected final cost
* Carrying costs
* Interest
* Taxes and insurance
* Sales and marketing costs
* Estimated sale price
* Net proceeds
* Projected profit
* Investor return
* Timeline
* Construction updates
* Photos
* Major risks
* Approved material decisions
* Distribution history
* Investor documents
* Monthly investor report

Visibility must be configurable. An investor may need high-level financial reporting without access to every vendor invoice or internal conversation.

## 20. Lender and draw-inspection support

For construction loans:

* Lender contact
* Loan amount
* Draw schedule
* Interest reserve
* Required lender forms
* Inspection requests
* Inspection results
* Percent-complete tracking
* Lender draw submission
* Supporting invoices
* Lien waivers
* Funds requested
* Funds received
* Timing and shortfall tracking

Generate a lender-ready draw package from existing project data rather than assembling it manually.

## 21. Permits and inspections

* Permit requirements
* Application date
* Permit number
* Jurisdiction
* Fees
* Status
* Required inspections
* Inspection request date
* Scheduled date
* Result
* Failed items
* Reinspection
* Inspector notes
* Supporting photos
* Certificate of occupancy
* Expiration reminders

Inspection failures should automatically create corrective tasks.

## 22. Compliance and risk management

* Subcontract agreements
* Insurance requirements
* COI verification
* W-9 tracking
* Licenses
* Lien waivers
* Safety documents
* Incident reports
* OSHA records where applicable
* Contract notice deadlines
* Warranty notices
* Document retention
* Access logs
* Audit history

Potentially critical alerts:

* Vendor working with expired insurance
* Payment requested without lien waiver
* Unsigned change order
* Work proceeding from an obsolete plan
* Client approval missing
* Contract amount exceeded
* Invoice duplicated
* Cost coded to a closed project
* Unusual financial adjustment

## 23. Inventory, tools, and company assets

Optional but useful later:

* Company tools and equipment
* Assigned employee or project
* Checkout history
* Maintenance reminders
* Purchase information
* Serial numbers
* Photos
* Lost/damaged status
* Trailers
* Vehicles
* Fuel and maintenance
* Material inventory
* Leftover project materials
* Storage locations

## 24. Employees and internal operations

Even with a small company now, design for growth.

* Staff accounts
* Roles and permissions
* Time tracking
* Project assignments
* Mileage
* Expense reimbursement
* PTO/calendar
* Training records
* License/certification expiration
* Internal procedures
* Employee onboarding
* Performance and workload reporting

Sensitive employee information should be isolated from ordinary project access.

## 25. Warranty and service

The portal should continue after the project closes.

### Closeout

* Final punch list
* Certificate of occupancy
* Final inspection
* Final billing
* Final lien waivers
* Warranties
* Manuals
* Paint colors
* Product selections
* Subcontractor contacts
* Maintenance schedule
* Client orientation
* Closeout acknowledgment
* Archive project

### Warranty portal

Clients should submit:

* Location
* Issue type
* Description
* Photos/video
* Urgency
* Availability
* Date first noticed

Internal workflow:

* Determine warranty eligibility
* Assign subcontractor
* Schedule visit
* Track communication
* Record correction
* Capture completion photo
* Obtain client signoff
* Track recurring defects
* Charge client for non-warranty service where appropriate

The system should differentiate emergency issues, legitimate warranty claims, homeowner maintenance, and billable service calls.

## 26. Company reporting

You and your father should be able to see:

* Total work under contract
* Backlog
* Forecasted revenue
* Forecasted gross profit
* Builder fee earned versus billed
* Cash needed by project
* Accounts receivable
* Accounts payable
* Projects over budget
* Estimate accuracy
* Change-order volume
* Average project duration
* Vendor performance
* Cost-code variance across projects
* Lead conversion
* Sales pipeline value
* Warranty cost
* Profitability by project type
* Profitability by client/project
* Estimated versus actual company overhead
* Workload and capacity

Cost-plus projects still need profitability reporting. A project can generate builder fees but consume so much supervision time that it becomes a weak project.

## 27. Knowledge base and company standards

Create a private company library for:

* Standard scopes of work
* Contract templates
* Allowance language
* Selection templates
* Budget templates
* Schedule templates
* Quality-control checklists
* Inspection checklists
* Preferred products
* Typical details
* Vendor instructions
* Client education
* Warranty standards
* Building-code references
* Lessons learned

When a new project starts, the portal should pull from these templates.

## 28. AI features that would genuinely help

AI should assist, not silently alter financial records.

Useful features:

* Summarize daily logs
* Draft weekly client updates
* Identify overdue decisions
* Flag potential budget overruns
* Detect duplicate invoices
* Extract invoice data
* Suggest cost codes
* Compare vendor proposals
* Find scope exclusions
* Summarize contracts
* Identify contract deadlines
* Convert meeting notes into tasks
* Search plans and specifications
* Draft RFIs
* Create photo progress summaries
* Explain budget changes in client-friendly language
* Forecast schedule risk
* Build monthly investor reports
* Search the entire project history
* Answer “Why did this cost increase?”
* Answer “Who approved this?”
* Answer “Which projects used this vendor/product?”
* Draft warranty responses
* Identify missing closeout documentation

Financial edits, approvals, payments, permissions, and legally significant communications should always require human confirmation.

## 29. Less obvious scenarios worth planning for

The system should handle real-world exceptions:

* Two clients disagree over a selection
* A client divorces or changes authorized decision-makers
* A client stops paying
* A project is paused
* A project changes from fixed-price to cost-plus
* A vendor goes out of business
* A subcontractor abandons the project
* A vendor replaces its original proposal
* An invoice is submitted twice
* An expense belongs to two projects
* A credit arrives months later
* A change starts before pricing is finalized
* A material is discontinued after approval
* A client selects an item with an unacceptable lead time
* An inspection fails
* Weather delays several dependent tasks
* A lien notice is received
* Insurance expires during active work
* A client asks to hide information from another participant
* An investor joins or exits mid-project
* A project is sold before completion
* A warranty claim occurs after the subcontractor is no longer available
* An employee accidentally exposes an internal document
* QuickBooks costs are recoded after they were billed
* A finalized draw must be corrected
* A client makes a partial payment
* A contract amendment changes the fee percentage
* A project contains insurance-restoration proceeds
* An allowance receives a credit rather than an overage
* A client supplies their own materials
* Owner-supplied work delays construction
* A confidential project requires restricted access

These cases require audit trails, version history, permissions, reversals, and clear record status—never destructive overwriting.

## Recommended main navigation

I would structure the admin portal around:

* Home
* Leads
* Projects
* Action Center
* Schedule
* Financials
* Vendors
* Investors
* Warranty
* Reports
* Company Library
* Settings

Inside each project:

* Overview
* Tasks
* Schedule
* Budget
* Commitments
* Billing
* Change Orders
* Selections
* Documents
* Plans & RFIs
* Photos & Updates
* Daily Logs
* Conversations
* Contacts
* Inspections
* Warranty
* Activity
* Project Settings

## What should be integrated instead of custom-built

The portal should coordinate these systems rather than attempt to replace all of them:

* QuickBooks Desktop: official accounting record
* OneDrive or SharePoint: durable document storage
* DocuSign/Adobe Sign/Dropbox Sign: legally reliable e-signature
* ACH/payment provider: payment processing
* Outlook or Gmail: email delivery and capture
* Google/Outlook Calendar: calendar synchronization
* Supabase/PostgreSQL: portal database, permissions, and audit history
* Error monitoring: production diagnostics
* Cloud backups: disaster recovery

The portal becomes the unified interface while specialized systems perform the regulated or infrastructure-heavy work.

## Best build order

Trying to make all of this fully functional at once would create a huge, fragile system. I would divide it into priorities.

### First: operational core

* Projects and permissions
* Budgeting
* QuickBooks imports
* Commitments
* Draws/invoices
* Change orders
* Selections
* Documents
* Schedule
* Client portal
* Activity/audit trail

### Second: field and vendor operations

* Daily logs
* Photos
* RFIs
* Inspections
* Bid management
* Vendor portal
* Purchase orders/subcontracts
* COI/W-9/lien-waiver tracking

### Third: company expansion

* Leads and preconstruction
* Investor portal
* Lender draws
* Warranty/service
* Reporting
* Knowledge base
* AI assistance
* Asset management

The expanded prototype should visually demonstrate nearly all of these areas now, even if later phases are marked as preview-only. That lets you approve the whole product design before Claude buries months of backend work underneath an incomplete interface.

Most important: this should not simply become “Buildertrend with a Stone Column logo.” Your real competitive advantage would be combining cost-plus transparency, refined client presentation, QuickBooks-based job costs, vendor compliance, selections, draws, and investor reporting in one premium, extremely clear experience.
