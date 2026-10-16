import wixData from 'wix-data';
import wixWindow from 'wix-window';

$w.onReady(function () {
    wixData.query("ResourceLibrary")
        .find()
        .then((results) => {
            if (results.items.length > 0) {
                const items = results.items;
                
                $w("#repeater11").data = items;

                $w("#repeater11").onItemReady(($item, itemData, index) => {$item("#button21").onClick(async () => {
                        console.log("Clicked Item Data:", itemData); 

                        wixWindow.openLightbox("Resource form", itemData)
                            .catch((err) => {
                                console.error("Error opening lightbox:", err);
                            });

                        try {
                            if (itemData && itemData._id) {
                                let latestItem = await wixData.get("ResourceLibrary", itemData._id);
                                
                                if (latestItem) {
                                    let currentReqCount = Number(latestItem.requestCount) || 0;
                                    latestItem.requestCount = currentReqCount + 1;

                                    await wixData.update("ResourceLibrary", latestItem);
                                    console.log(`requestCount updated to ${latestItem.requestCount} for:`, latestItem.title);
                                }
                            }
                        } catch (updateErr) {
                            console.error("Error updating requestCount:", updateErr);
                        }
                    });
                });
            } else {
                console.log("No data found in Resource Library collection.");
            }
        })
        .catch((err) => {
            console.error("Error fetching data:", err);
        });
});