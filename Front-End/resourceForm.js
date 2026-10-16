import wixWindow from 'wix-window';
import wixData from 'wix-data';
import wixLocation from 'wix-location';
import { session } from 'wix-storage-frontend';

// Convert wix:document:// URL into a public direct-download URL
function toPublicDownloadUrl(wixDocUrl) {
    if (!wixDocUrl || typeof wixDocUrl !== "string") return "";
    const match = wixDocUrl.match(/^wix:document:\/\/v1\/(ugd\/[^/]+)\/(.+)$/);
    if (!match) return "";
    const filePath = match[1];   // e.g. ugd/1d684a_xxx.pdf
    const fileName = match[2];   // already URL-encoded
    return `${wixLocation.baseUrl}/_files/${filePath}?dn=${fileName}`;
}

$w.onReady(function () {
    // Step 1: Get the selected item data passed from the main page
    const selectedItem = wixWindow.lightbox.getContext();
    
    if (selectedItem) {
        console.log("Selected Item Data:", selectedItem);

        if (selectedItem.title) {
            $w("#text160").text = selectedItem.title;
        }
        if (selectedItem.image) {
            $w("#image27").src = selectedItem.image;
        }
    } else {
        console.warn("No item data received.");
    }

    // Step 2: Set initial button state (50% opacity, not disabled)
    $w("#formSubmit").style.backgroundColor = "rgba(53, 16, 137, 0.5)";

    // Function to check Name and Email validation
    function validateForm() {
        const nameValue = $w("#input1").value;
        const emailValue = $w("#input2").value;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isEmailValid = emailRegex.test(emailValue);

        if (nameValue.trim() !== "" && isEmailValid) {
            $w("#formSubmit").style.backgroundColor = "#351089"; // 100% solid
            return true;
        } else {
            $w("#formSubmit").style.backgroundColor = "rgba(53, 16, 137, 0.5)"; // 50% opacity
            return false;
        }
    }

    // Listen to input changes dynamically
    $w("#input1").onInput(() => { validateForm(); });
    $w("#input2").onInput(() => { validateForm(); });

    // Prevent double submit
    let isSubmitting = false;

    // Step 3: Handle Submit Button Click
    $w("#formSubmit").onClick(async () => {
        if (isSubmitting) return;

        const isFormValid = validateForm();

        if (!isFormValid) {
            console.warn("Form submission blocked: Please fill out Name and valid Email.");
            return; 
        }

        isSubmitting = true;

        const userName = $w("#input1").value.trim();
        const userEmail = $w("#input2").value.trim().toLowerCase();
        const isOptIn = $w("#checkbox1").checked; // Boolean type (true/false)
        const currentResourceTitle = selectedItem ? selectedItem.title : "Unknown Resource";
        const currentResourceDoc = selectedItem ? selectedItem.document : null;
        const publicDownloadUrl = toPublicDownloadUrl(currentResourceDoc);

        // Format current date and time nicely (e.g., "Oct 15, 2026, 10:30 PM")
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const formattedDateTime = `${dateStr}, ${timeStr}`;

        // Prepare submission data object securely
        const submissionData = {
            selectedResource: {
                id: selectedItem ? selectedItem._id : "N/A",
                title: currentResourceTitle,
                document: currentResourceDoc,
                downloadUrl: publicDownloadUrl,
                image: selectedItem ? selectedItem.image : ""
            },
            userInfo: {
                name: userName,
                email: userEmail,
                agreedToTerms: isOptIn
            },
            submittedAt: formattedDateTime
        };

        // Save backup to session IMMEDIATELY (before any database work)
        try {
            session.setItem("lastResourceSubmission", JSON.stringify(submissionData));
        } catch (e) {
            console.warn("Session backup failed:", e);
        }

        // =========================================================================
        // Step 4: Update total 'downloadCount' in ResourceLibrary collection
        // =========================================================================
        try {
            if (selectedItem && selectedItem._id) {
                let libraryItem = await wixData.get("ResourceLibrary", selectedItem._id);
                if (libraryItem) {
                    let currentCount = Number(libraryItem.downloadCount) || 0;
                    libraryItem.downloadCount = currentCount + 1;

                    await wixData.update("ResourceLibrary", libraryItem);
                    console.log("ResourceLibrary total downloadCount updated to:", libraryItem.downloadCount);
                }
            }
        } catch (updateErr) {
            console.error("Error updating ResourceLibrary downloadCount:", updateErr);
        }

        // =========================================================================
        // Step 5: Insert individual log row into 'ResourceRequests' collection
        // =========================================================================
        try {
            const toSaveIndividual = {
                title: currentResourceTitle, 
                resourceTitle: currentResourceTitle,
                resourcesFile: currentResourceDoc,
                downloadLink: publicDownloadUrl,   // <-- NEW: public link for automation email
                firstName: userName,
                email: userEmail,
                marketingOptIn: isOptIn, 
                downloadDate: formattedDateTime,          
                downloadClicked: true,                  
                downloadCount: 1
            };

            await wixData.insert("ResourceRequests", toSaveIndividual);
            console.log("New row created in ResourceRequests collection.");
        } catch (err) {
            console.error("Error saving data into ResourceRequests collection:", err);
        }

        // =========================================================================
        // Step 6: Single-Row User Tracking in 'AllSubscriberResourcesRequest'
        // =========================================================================
        try {
            const subscriberQuery = await wixData.query("AllSubscriberResourcesRequest")
                .eq("email", userEmail)
                .find();

            let itemsMap = {};

            if (subscriberQuery.items.length > 0) {
                // User already exists -> Update existing row
                let existingUserRow = subscriberQuery.items[0];

                existingUserRow.firstName = userName;
                existingUserRow.marketingOptIn = isOptIn; 
                existingUserRow.lastDownloadDate = formattedDateTime;

                // Total Downloads increment as Number field
                let prevTotal = Number(existingUserRow.totalDownloads) || 0;
                existingUserRow.totalDownloads = prevTotal + 1;

                // Load existing resource state safely from resourcesJson
                if (existingUserRow.resourcesJson) {
                    try { 
                        itemsMap = JSON.parse(existingUserRow.resourcesJson); 
                    } catch (e) { 
                        itemsMap = {}; 
                    }
                }

                // Update Quantity & Dates accurately
                if (itemsMap[currentResourceTitle]) {
                    itemsMap[currentResourceTitle].qty += 1;
                    itemsMap[currentResourceTitle].dates.push(formattedDateTime);
                } else {
                    itemsMap[currentResourceTitle] = { 
                        qty: 1, 
                        dates: [formattedDateTime] 
                    };
                }

                // Save back JSON state
                existingUserRow.resourcesJson = JSON.stringify(itemsMap);

                // Re-build line-by-line summary and tags array
                let summaryArr = [];
                let tagsArr = [];
                let idx = 1;
                for (let title in itemsMap) {
                    let datesFormatted = itemsMap[title].dates.join(", ");
                    summaryArr.push(`${idx}. ${title} | (Quantity: ${itemsMap[title].qty}) | Date: ${datesFormatted}`);
                    tagsArr.push(title);
                    idx++;
                }

                existingUserRow.resourcesSummary = summaryArr.join("\n");
                existingUserRow.allResources = tagsArr; // Tag field

                // Handle Multiple Documents (allResourcesDocuments) ensuring no duplicates
                let existingDocs = Array.isArray(existingUserRow.allResourcesDocuments) ? existingUserRow.allResourcesDocuments : [];
                if (currentResourceDoc && !existingDocs.includes(currentResourceDoc)) {
                    existingDocs.push(currentResourceDoc);
                }
                existingUserRow.allResourcesDocuments = existingDocs;

                await wixData.update("AllSubscriberResourcesRequest", existingUserRow);
                console.log("Updated existing subscriber row in AllSubscriberResourcesRequest.");

            } else {
                // New user -> Create new row
                itemsMap[currentResourceTitle] = { 
                    qty: 1, 
                    dates: [formattedDateTime] 
                };

                const initialSummary = `1. ${currentResourceTitle} | (Quantity: 1) | Date: ${formattedDateTime}`;
                let docsArray = currentResourceDoc ? [currentResourceDoc] : [];

                const newSubscriberRow = {
                    email: userEmail,
                    firstName: userName,
                    marketingOptIn: isOptIn, 
                    firstDownloadDate: formattedDateTime,
                    lastDownloadDate: formattedDateTime,
                    totalDownloads: 1, 
                    resourcesJson: JSON.stringify(itemsMap),
                    resourcesSummary: initialSummary,
                    allResources: [currentResourceTitle], 
                    allResourcesDocuments: docsArray      
                };

                await wixData.insert("AllSubscriberResourcesRequest", newSubscriberRow);
                console.log("Created new subscriber row in AllSubscriberResourcesRequest.");
            }
        } catch (subErr) {
            console.error("Error in AllSubscriberResourcesRequest collection:", subErr);
        }

        // =========================================================================
        // Step 7: Open Thank You lightbox with current data
        // =========================================================================
        console.log("Passing Current Data to Thank You Lightbox:", submissionData);

        try {
            wixWindow.openLightbox("Thank you message", submissionData);
        } catch (lightboxErr) {
            console.error("Error opening Thank You lightbox:", lightboxErr);
            isSubmitting = false;
        }
    });
});